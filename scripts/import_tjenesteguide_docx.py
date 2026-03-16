#!/usr/bin/env python3
"""Import service-level data from DOCX into server/data/tjenester.json.

This importer reads heading-based sections directly from the DOCX and outputs
only service records in the current application model (no legacy node fields).
Subservice-like heading4 blocks are embedded as variants on their parent
service instead of becoming standalone records.
"""

from __future__ import annotations

import base64
import html
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DOCX_PATH = ROOT / "Tjenesteguide fra Astrid 21 01 26.docx"
OUT_PATH = ROOT / "server" / "data" / "tjenester.json"
DEFAULT_METADATA = {
    "generell_beskrivelse": (
        "Tjenesteguide samler informasjon om tjenester levert av Alta kommune "
        "og samarbeidspartnere."
    ),
    "generell_beskrivelse_plain_text": (
        "Tjenesteguide samler informasjon om tjenester levert av Alta kommune "
        "og samarbeidspartnere."
    ),
    "generell_beskrivelse_rich_base64": base64.b64encode(
        (
            "Tjenesteguide samler informasjon om tjenester levert av Alta kommune "
            "og samarbeidspartnere."
        ).encode("utf-8")
    ).decode("ascii"),
}

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

BLOCK_MARKERS: dict[str, list[str]] = {
    "for_du_soker": ["før du søker", "for du søker"],
    "beskrivelse": ["beskrivelse av tjenesten", "beskrivelse"],
    "soknad": ["søknad og saksbehandling", "søknad"],
    "malgruppe": ["målgruppe"],
    "tildelingskriterier": ["tildelingskriterier", "kriterier for tildeling"],
    "dette_inngar_ikke_i_tjenestetilbudet": [
        "dette inngår ikke i tjenestetilbudet",
        "dette inngår ikke i bpa",
        "dette inngår ikke",
    ],
    "vedtak": ["vedtak om tjenesten"],
    "hva_kan_du_forvente": ["dette kan du forvente", "hva kan du forvente"],
    "forventninger_til_bruker": ["våre forventninger", "hva forventes av deg"],
    "evaluering": ["evaluering"],
    "pris": ["pris for tjenesten", "pris"],
    "lovhjemmel": ["lovhjemmel"],
    "kontakt": ["kontaktinformasjon", "kontakt"],
}

SERVICE_MARKERS = {
    "for_du_soker",
    "tildelingskriterier",
    "dette_inngar_ikke_i_tjenestetilbudet",
    "vedtak",
    "soknad",
    "lovhjemmel",
    "hva_kan_du_forvente",
    "forventninger_til_bruker",
    "evaluering",
    "pris",
    "beskrivelse",
}

EXCLUDED_TITLES = {
    "Dersom du oppfyller kriteriene for HDO-bolig, men kan bo med et annet forsvarlig tjenestetilbud i påvente av ledig bolig, vil du få tilbud om å stå på venteliste dersom det ikke er ledig bolig når du søker."
}


@dataclass
class HeadingSection:
    index: int
    style: str
    title: str
    lines: list[str]
    heading1: str | None
    heading2: str | None


def normalize_space(text: str) -> str:
    value = text.replace("\xa0", " ")
    value = value.replace("‐", "-").replace("–", "-").replace("—", "-")
    return " ".join(value.split()).strip()


def normalize_label(text: str) -> str:
    value = normalize_space(text).casefold()
    value = re.sub(r"[!?:;,.]", " ", value)
    value = value.replace("/", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def decode_base64_to_utf8(value: str | None) -> str:
    if not value:
        return ""
    try:
        return base64.b64decode(value).decode("utf-8")
    except Exception:
        return ""


def encode_utf8_to_base64(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def strip_html_to_plain_text(value: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"</(p|div|li|tr|h[1-6])>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = text.replace("\r\n", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def plain_text_to_rich_html(value: str) -> str:
    if not value:
        return ""
    return escape_html(value).replace("\r\n", "\n").replace("\n", "<br>")


def normalize_metadata(metadata: dict | None) -> dict:
    if not isinstance(metadata, dict):
        metadata = {}

    decoded_rich = decode_base64_to_utf8(metadata.get("generell_beskrivelse_rich_base64"))
    plain_from_rich = strip_html_to_plain_text(decoded_rich) if decoded_rich else ""
    explicit_plain = (
        metadata["generell_beskrivelse_plain_text"]
        if isinstance(metadata.get("generell_beskrivelse_plain_text"), str)
        else None
    )
    explicit_description = (
        metadata["generell_beskrivelse"]
        if isinstance(metadata.get("generell_beskrivelse"), str)
        else None
    )
    plain = explicit_plain
    if plain is None:
        plain = explicit_description
    if plain is None:
        plain = plain_from_rich or DEFAULT_METADATA["generell_beskrivelse"]
    rich_html = decoded_rich or plain_text_to_rich_html(plain)

    return {
        "generell_beskrivelse": plain,
        "generell_beskrivelse_plain_text": plain,
        "generell_beskrivelse_rich_base64": encode_utf8_to_base64(rich_html),
    }


def heading_level(style: str) -> int | None:
    match = re.fullmatch(r"Heading([1-6])", style)
    if not match:
        return None
    return int(match.group(1))


def has_alpha(text: str) -> bool:
    return any(ch.isalpha() for ch in text)


def is_upper_title(text: str) -> bool:
    stripped = normalize_space(text)
    return has_alpha(stripped) and stripped == stripped.upper()


def looks_like_service_name(line: str) -> bool:
    text = normalize_space(line)
    if len(text) < 3 or len(text) > 96:
        return False
    if any(ch in text for ch in ".?!"):
        return False
    lowered = text.casefold()
    if lowered.startswith(("visste", "i alta", "hvis ", "du ")):
        return False
    return has_alpha(text)


def paragraph_text(paragraph: ET.Element) -> str:
    parts = [node.text for node in paragraph.findall(".//w:t", NS) if node.text]
    return normalize_space("".join(parts))


def paragraph_style(paragraph: ET.Element) -> str | None:
    props = paragraph.find("w:pPr", NS)
    if props is None:
        return None
    style = props.find("w:pStyle", NS)
    if style is None:
        return None
    return style.get(f"{{{NS['w']}}}val")


def parse_heading_sections(docx_path: Path) -> list[HeadingSection]:
    with ZipFile(docx_path) as archive:
        document_root = ET.fromstring(archive.read("word/document.xml"))

    body = document_root.find("w:body", NS)
    if body is None:
        raise RuntimeError("Could not locate document body")

    sections: list[HeadingSection] = []
    current: HeadingSection | None = None
    current_h1: str | None = None
    current_h2: str | None = None

    for paragraph in body.findall("w:p", NS):
        text = paragraph_text(paragraph)
        if not text:
            continue

        style = paragraph_style(paragraph)
        if style and style.startswith("Heading"):
            if current is not None:
                sections.append(current)

            if style == "Heading1":
                current_h1 = text
                current_h2 = None
            elif style == "Heading2":
                current_h2 = text

            current = HeadingSection(
                index=len(sections),
                style=style,
                title=text,
                lines=[],
                heading1=current_h1,
                heading2=current_h2,
            )
            continue

        if current is not None:
            current.lines.append(text)

    if current is not None:
        sections.append(current)

    return sections


def has_child_of_level(
    sections: list[HeadingSection], index: int, child_style: str
) -> bool:
    parent_level = heading_level(sections[index].style)
    if parent_level is None:
        return False

    for child in sections[index + 1 :]:
        child_level = heading_level(child.style)
        if child_level is None:
            continue
        if child_level <= parent_level:
            break
        if child.style == child_style:
            return True
    return False


def detect_marker(line: str) -> tuple[str, str] | None:
    words = normalize_space(line).split()
    if not words:
        return None

    for key, variants in BLOCK_MARKERS.items():
        for variant in variants:
            variant_word_count = len(variant.split())
            if len(words) < variant_word_count:
                continue

            prefix = " ".join(words[:variant_word_count])
            if normalize_label(prefix) != normalize_label(variant):
                continue

            remainder = " ".join(words[variant_word_count:]).lstrip(":-").strip()
            return key, remainder

    return None


def collect_markers(lines: Iterable[str]) -> set[str]:
    markers: set[str] = set()
    for line in lines:
        marker = detect_marker(line)
        if marker:
            markers.add(marker[0])
    return markers


def split_blocks(lines: Iterable[str]) -> dict[str, list[str]]:
    blocks: dict[str, list[str]] = {"body": []}
    current = "body"

    for line in lines:
        marker = detect_marker(line)
        if marker:
            current = marker[0]
            blocks.setdefault(current, [])
            if marker[1]:
                blocks[current].append(marker[1])
            continue

        blocks.setdefault(current, []).append(line)

    return blocks


def is_service_section(section: HeadingSection, sections: list[HeadingSection]) -> bool:
    if not section.lines:
        return False
    if section.title in EXCLUDED_TITLES:
        return False
    if section.style == "Heading4":
        return False

    if section.style == "Heading3":
        return True

    if section.style in {"Heading1", "Heading2"}:
        if is_upper_title(section.title):
            return False
        if len(section.title) > 110:
            return False
        if has_child_of_level(sections, section.index, "Heading3"):
            return False

        markers = collect_markers(section.lines)
        if markers & SERVICE_MARKERS:
            return True
        if has_child_of_level(sections, section.index, "Heading4"):
            return True
        if section.lines and looks_like_service_name(section.lines[0]):
            return True

    return False


def extract_links(lines: Iterable[str]) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    seen: set[str] = set()
    for line in lines:
        for url in re.findall(r"https?://\S+", line):
            cleaned = url.rstrip(").,;\"]'")
            if cleaned in seen:
                continue
            seen.add(cleaned)
            links.append({"beskrivelse": "Lenke i dokument", "url": cleaned})
    return links


def extract_contacts(lines: Iterable[str]) -> list[dict[str, str]]:
    contacts: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    for line in lines:
        for email in re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", line):
            key = ("epost", email)
            if key in seen:
                continue
            seen.add(key)
            contacts.append({"type": "epost", "beskrivelse": "E-post", "verdi": email})

        for phone in re.findall(
            r"(?:\+?47[\s-]?)?(?:\d{2}[\s-]?){4}", line.replace("\xa0", " ")
        ):
            cleaned = " ".join(phone.split()).strip()
            if len(re.sub(r"\D", "", cleaned)) < 8:
                continue
            key = ("telefon", cleaned)
            if key in seen:
                continue
            seen.add(key)
            contacts.append({"type": "telefon", "beskrivelse": "Telefon", "verdi": cleaned})

    return contacts


def infer_malgruppe_categories(text: str) -> list[str]:
    source = text.casefold()
    categories: list[str] = []

    def add(label: str) -> None:
        if label not in categories:
            categories.append(label)

    if any(word in source for word in ("barn", "unge", "voksne", "eldre")):
        add("Alder")
    if any(word in source for word in ("pårørende", "parorende")):
        add("Pårørende")
    if any(word in source for word in ("demens", "kreft", "helse", "sykdom")):
        add("Sykdom / helse")
    if any(word in source for word in ("funksjons", "nedsatt funksjonsevne")):
        add("Funksjonsnedsettelse")
    if any(word in source for word in ("rus", "psykisk", "økonomi", "sosial")):
        add("Sosiale utfordringer")

    if not categories:
        add("Alle innbyggere")

    return categories


def to_text_array(lines: Iterable[str]) -> list[str] | None:
    cleaned = [normalize_space(line) for line in lines if normalize_space(line)]
    if not cleaned:
        return None
    return ["\n".join(cleaned)]


def extract_lovhjemmel(lines: Iterable[str]) -> list[dict[str, str]] | None:
    entries: list[dict[str, str]] = []
    seen: set[tuple[str, str | None, str | None]] = set()

    for line in lines:
        text = normalize_space(line)
        if not text:
            continue

        url_match = re.search(r"https?://\S+", text)
        url = url_match.group(0).rstrip(").,;\"]'") if url_match else None
        text_without_url = text.replace(url_match.group(0), "").strip() if url_match else text

        paragraf_match = re.search(r"(§\s*[\dA-Za-z.\-]+)", text_without_url)
        paragraf = paragraf_match.group(1).strip() if paragraf_match else None

        law_text = text_without_url
        if paragraf:
            law_text = law_text.replace(paragraf, "").strip(" ,;-:")
        if not law_text:
            law_text = text_without_url
        if not law_text:
            continue

        key = (law_text, paragraf, url)
        if key in seen:
            continue
        seen.add(key)

        entry: dict[str, str] = {"lov": law_text}
        if paragraf:
            entry["paragraf"] = paragraf
        if url:
            entry["url"] = url
        entries.append(entry)

    return entries or None


def first_nonempty(lines: Iterable[str], fallback: str) -> str:
    for line in lines:
        text = normalize_space(line)
        if text:
            return text
    return fallback


def dedupe_strings(values: Iterable[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = normalize_space(value)
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(cleaned)
    return deduped


def plain_text_to_rich_base64(value: str) -> str:
    rich_html = html.escape(value).replace("\n", "<br>")
    return base64.b64encode(rich_html.encode("utf-8")).decode("ascii")


def collect_heading4_variants(
    sections: list[HeadingSection], index: int
) -> list[dict[str, list[str] | str]]:
    variants: list[dict[str, list[str] | str]] = []
    parent_level = heading_level(sections[index].style)
    if parent_level is None:
        return variants

    for child in sections[index + 1 :]:
        child_level = heading_level(child.style)
        if child_level is None:
            continue
        if child_level <= parent_level:
            break
        if child.style != "Heading4":
            continue
        if not child.lines:
            continue

        variant_text = "\n".join(dedupe_strings(child.lines))
        variant: dict[str, list[str] | str] = {"navn": child.title}
        if variant_text:
            variant["ekstra_kriterier"] = [variant_text]
        variants.append(variant)

    return variants


def build_categories(section: HeadingSection, vedtaksbasert: bool) -> list[str]:
    categories = ["Tjenester med vedtak" if vedtaksbasert else "Tjenester uten vedtak"]

    if section.style == "Heading3":
        context = section.heading2 or section.heading1
        if context and context != section.title and not is_upper_title(context):
            categories.append(context)
    elif section.style == "Heading2":
        if (
            section.heading1
            and section.heading1 != section.title
            and not is_upper_title(section.heading1)
        ):
            categories.append(section.heading1)

    return dedupe_strings(categories)


def build_service_item(
    section: HeadingSection,
    index: int,
    trinn_niva: str,
    variants: list[dict[str, list[str] | str]],
) -> dict:
    vedtaksbasert = trinn_niva != "grunnmur"
    lines = dedupe_strings(section.lines)
    blocks = split_blocks(lines)

    description_source = blocks.get("beskrivelse") or blocks.get("body") or lines
    beskrivelse = first_nonempty(description_source, section.title)
    all_text = "\n".join(lines)

    kategori_sti = build_categories(section, vedtaksbasert)
    trinn_label = "Grunnmur" if trinn_niva == "grunnmur" else trinn_niva.replace("trinn", "Trinn ")
    temaer = dedupe_strings(
        [*kategori_sti, trinn_label, "Vedtaksbasert" if vedtaksbasert else "Lavterskel"]
    )

    malgruppe_text = "\n".join(blocks.get("malgruppe", [])).strip()
    malgruppe: list[dict] = []
    if malgruppe_text:
        malgruppe.append(
            {
                "beskrivelse": malgruppe_text,
                "kategorier": infer_malgruppe_categories(f"{section.title} {malgruppe_text}"),
            }
        )
    else:
        inferred_categories = infer_malgruppe_categories(section.title)
        if inferred_categories and section.title.casefold() != "tjenestekontoret":
            malgruppe.append(
                {
                    "beskrivelse": section.title,
                    "kategorier": inferred_categories,
                }
            )

    links = extract_links(lines)
    contacts = extract_contacts(lines)

    item: dict = {
        "id": f"{index:06d}",
        "navn": section.title,
        "kategori_sti": kategori_sti,
        "temaer": temaer,
        "tjenestetype": "Vedtaksbasert tjeneste" if vedtaksbasert else "Lavterskel tilbud",
        "vedtaksbasert": vedtaksbasert,
        "lavterskel": not vedtaksbasert,
        "trinn_nivå": trinn_niva,
        "målgruppe": malgruppe,
        "beskrivelse": beskrivelse,
        "beskrivelse_plain_text": beskrivelse,
        "beskrivelse_rich_base64": plain_text_to_rich_base64(beskrivelse),
        "status": "aktiv",
        "interne_notater": [all_text],
    }

    for_du_soker = to_text_array(blocks.get("for_du_soker", []))
    if for_du_soker:
        item["for_du_søker"] = for_du_soker
        item["for_du_søker_plain_text"] = for_du_soker[0]
        item["for_du_søker_rich_base64"] = plain_text_to_rich_base64(for_du_soker[0])

    tildelingskriterier = to_text_array(blocks.get("tildelingskriterier", []))
    if tildelingskriterier:
        item["tildelingskriterier"] = tildelingskriterier
        item["tildelingskriterier_plain_text"] = tildelingskriterier[0]
        item["tildelingskriterier_rich_base64"] = plain_text_to_rich_base64(
            tildelingskriterier[0]
        )

    dette_inngar_ikke = to_text_array(blocks.get("dette_inngar_ikke_i_tjenestetilbudet", []))
    if dette_inngar_ikke:
        item["dette_inngår_ikke_i_tjenestetilbudet"] = dette_inngar_ikke
        item["dette_inngår_ikke_i_tjenestetilbudet_plain_text"] = dette_inngar_ikke[0]
        item["dette_inngår_ikke_i_tjenestetilbudet_rich_base64"] = plain_text_to_rich_base64(
            dette_inngar_ikke[0]
        )

    kan_forvente = to_text_array(blocks.get("hva_kan_du_forvente", []))
    if kan_forvente:
        item["hva_kan_du_forvente"] = kan_forvente
        item["hva_kan_du_forvente_plain_text"] = kan_forvente[0]
        item["hva_kan_du_forvente_rich_base64"] = plain_text_to_rich_base64(kan_forvente[0])

    forventninger = to_text_array(blocks.get("forventninger_til_bruker", []))
    if forventninger:
        item["forventninger_til_bruker"] = forventninger
        item["forventninger_til_bruker_plain_text"] = forventninger[0]
        item["forventninger_til_bruker_rich_base64"] = plain_text_to_rich_base64(
            forventninger[0]
        )

    evaluering = to_text_array(blocks.get("evaluering", []))
    if evaluering:
        item["evaluering"] = {"spørsmål": evaluering}

    pris_lines = blocks.get("pris", [])
    if pris_lines:
        pris_text = "\n".join(dedupe_strings(pris_lines))
        price_type = "gratis" if "gratis" in pris_text.casefold() else "egenandel"
        pris: dict = {"betalingstype": price_type, "beskrivelse": pris_text}
        amount_match = re.search(r"(\d+(?:[.,]\d{1,2})?)\s*(?:kr|kroner)\b", pris_text, re.I)
        if amount_match and price_type != "gratis":
            pris["beløp"] = float(amount_match.group(1).replace(",", "."))
        if links:
            pris["prislenke"] = links[0]["url"]
        item["pris"] = pris

    if vedtaksbasert:
        vedtak_lines = dedupe_strings(blocks.get("vedtak", []))
        soknad_lines = dedupe_strings(blocks.get("soknad", []))
        vedtak: dict = {
            "krever_søknad": True,
            "søknadsvei": "\n".join(soknad_lines)
            if soknad_lines
            else "Kontakt Tjenestekontoret for informasjon om søknad.",
        }
        if vedtak_lines:
            vedtak["korte_punkter"] = vedtak_lines[:12]
        soknad_link = next((link["url"] for link in links if "sok" in link["url"].casefold()), None)
        if soknad_link:
            vedtak["søknad_url"] = soknad_link
        item["vedtak"] = vedtak

    lovhjemmel = extract_lovhjemmel(blocks.get("lovhjemmel", []))
    if lovhjemmel:
        item["lovhjemmel"] = lovhjemmel

    if contacts:
        item["kontaktpunkter"] = contacts
    if links:
        item["eksterne_lenker"] = links
    if variants:
        item["særlige_varianter"] = variants

    return item


def build_services(sections: list[HeadingSection]) -> list[dict]:
    services: list[dict] = []
    in_vedtak_part = False
    current_trinn = "grunnmur"

    def update_trinn_state(title: str, current: str) -> str:
        normalized = normalize_label(title)
        if "trinn 1" in normalized:
            return "trinn1"
        if "trinn 2" in normalized:
            return "trinn2"
        if "trinn 3" in normalized:
            return "trinn3"
        return current

    def infer_service_trinn(title: str, current: str, is_vedtak_part: bool) -> str:
        if not is_vedtak_part:
            return "grunnmur"

        normalized = normalize_label(title)
        if "tidsbegrenset opphold i korttidsavdeling" in normalized:
            return "trinn4"
        if "hdo-bolig" in normalized or "heldøgns tjenester" in normalized:
            return "trinn5"
        if "langtidsopphold i sykehjem" in normalized:
            return "trinn6"
        return current

    for section in sections:
        if "TJENESTER MED VEDTAK" in section.title.upper():
            in_vedtak_part = True
        current_trinn = update_trinn_state(section.title, current_trinn)

        if not is_service_section(section, sections):
            continue

        trinn_niva = infer_service_trinn(section.title, current_trinn, in_vedtak_part)
        variants = collect_heading4_variants(sections, section.index)
        item = build_service_item(
            section=section,
            index=len(services) + 1,
            trinn_niva=trinn_niva,
            variants=variants,
        )
        services.append(item)

    return services


def load_existing_metadata() -> dict:
    if not OUT_PATH.exists():
        return normalize_metadata(DEFAULT_METADATA)

    try:
        parsed = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return normalize_metadata(DEFAULT_METADATA)

    if isinstance(parsed, dict) and isinstance(parsed.get("metadata"), dict):
        return normalize_metadata(parsed["metadata"])

    return normalize_metadata(DEFAULT_METADATA)


def main() -> None:
    if not DOCX_PATH.exists():
        raise FileNotFoundError(f"Source file not found: {DOCX_PATH}")

    sections = parse_heading_sections(DOCX_PATH)
    services = build_services(sections)
    metadata = load_existing_metadata()

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(
            {
                "metadata": metadata,
                "tjenester": services,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"Imported services: {len(services)}")
    print(f"Source: {DOCX_PATH}")
    print(f"Output: {OUT_PATH}")


if __name__ == "__main__":
    main()
