import { useState, useEffect, useMemo, useRef, useId } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Tjeneste,
  Målgruppe,
  TrinnNiva,
  PrisInfo,
  Lovhjemmel,
  Kontaktpunkt,
  EksternLenke,
} from "../types/tjeneste";
import {
  fetchTjenesteById,
  fetchTjenester,
  createTjeneste,
  updateTjeneste,
} from "../api/tjenester";
import Modal from "../components/Modal";
import RichTextEditor from "../components/RichTextEditor";
import {
  normalizeBeskrivelseRepresentations,
  normalizeRichTextFromLegacyArray,
  resolveRichHtml,
  resolveRichHtmlFromLegacyArray,
  stripRichTextToPlainText,
  encodeUtf8ToBase64,
} from "../utils/richText";

const INITIAL_FORM_DATA: Tjeneste = {
  id: "",
  navn: "",
  kategori_sti: [],
  temaer: [],
  tjenestetype: "",
  vedtaksbasert: false,
  lavterskel: true,
  trinn_nivå: "grunnmur",
  målgruppe: [],
  beskrivelse: "",
  beskrivelse_plain_text: "",
  beskrivelse_rich_base64: "",
  for_du_søker_plain_text: "",
  for_du_søker_rich_base64: "",
  tildelingskriterier_plain_text: "",
  tildelingskriterier_rich_base64: "",
  dette_inngår_ikke_i_tjenestetilbudet_plain_text: "",
  dette_inngår_ikke_i_tjenestetilbudet_rich_base64: "",
  hva_kan_du_forvente_plain_text: "",
  hva_kan_du_forvente_rich_base64: "",
  forventninger_til_bruker_plain_text: "",
  forventninger_til_bruker_rich_base64: "",
  status: "aktiv",
};

const TRINN_OPTIONS: Array<{ value: TrinnNiva; label: string }> = [
  { value: "grunnmur", label: "Grunnmur" },
  { value: "trinn1", label: "Trinn 1" },
  { value: "trinn2", label: "Trinn 2" },
  { value: "trinn3", label: "Trinn 3" },
  { value: "trinn4", label: "Trinn 4" },
  { value: "trinn5", label: "Trinn 5" },
  { value: "trinn6", label: "Trinn 6" },
];

const DEFAULT_MÅLGRUPPE_KATEGORIER = [
  "Alle innbyggere",
  "Alder",
  "Nasjonalitet / etnisitet",
  "Sykdom / helse",
  "Funksjonsnedsettelse",
  "Sosiale utfordringer",
  "Pårørende",
];

function normalizeLegacyRichTextFields(data: Tjeneste) {
  const forDuSoker = normalizeRichTextFromLegacyArray({
    plain_text: data.for_du_søker_plain_text,
    rich_base64: data.for_du_søker_rich_base64,
    legacy_array: data.for_du_søker,
  });
  const tildelingskriterier = normalizeRichTextFromLegacyArray({
    plain_text: data.tildelingskriterier_plain_text,
    rich_base64: data.tildelingskriterier_rich_base64,
    legacy_array: data.tildelingskriterier,
  });
  const detteInngårIkkeITjenestetilbudet = normalizeRichTextFromLegacyArray({
    plain_text: data.dette_inngår_ikke_i_tjenestetilbudet_plain_text,
    rich_base64: data.dette_inngår_ikke_i_tjenestetilbudet_rich_base64,
    legacy_array: data.dette_inngår_ikke_i_tjenestetilbudet,
  });
  const hvaKanDuForvente = normalizeRichTextFromLegacyArray({
    plain_text: data.hva_kan_du_forvente_plain_text,
    rich_base64: data.hva_kan_du_forvente_rich_base64,
    legacy_array: data.hva_kan_du_forvente,
  });
  const forventningerTilBruker = normalizeRichTextFromLegacyArray({
    plain_text: data.forventninger_til_bruker_plain_text,
    rich_base64: data.forventninger_til_bruker_rich_base64,
    legacy_array: data.forventninger_til_bruker,
  });

  return {
    for_du_søker: forDuSoker.legacy_array,
    for_du_søker_plain_text: forDuSoker.plain_text,
    for_du_søker_rich_base64: forDuSoker.rich_base64,
    tildelingskriterier: tildelingskriterier.legacy_array,
    tildelingskriterier_plain_text: tildelingskriterier.plain_text,
    tildelingskriterier_rich_base64: tildelingskriterier.rich_base64,
    dette_inngår_ikke_i_tjenestetilbudet:
      detteInngårIkkeITjenestetilbudet.legacy_array,
    dette_inngår_ikke_i_tjenestetilbudet_plain_text:
      detteInngårIkkeITjenestetilbudet.plain_text,
    dette_inngår_ikke_i_tjenestetilbudet_rich_base64:
      detteInngårIkkeITjenestetilbudet.rich_base64,
    hva_kan_du_forvente: hvaKanDuForvente.legacy_array,
    hva_kan_du_forvente_plain_text: hvaKanDuForvente.plain_text,
    hva_kan_du_forvente_rich_base64: hvaKanDuForvente.rich_base64,
    forventninger_til_bruker: forventningerTilBruker.legacy_array,
    forventninger_til_bruker_plain_text: forventningerTilBruker.plain_text,
    forventninger_til_bruker_rich_base64: forventningerTilBruker.rich_base64,
  };
}

export default function TjenesteForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = id !== undefined && id !== "ny";
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [existingTjenestetyper, setExistingTjenestetyper] = useState<string[]>([]);
  const [existingLeverandører, setExistingLeverandører] = useState<string[]>([]);
  const [existingMålgruppeNavn, setExistingMålgruppeNavn] = useState<string[]>([]);
  const [existingMålgruppeKategorier, setExistingMålgruppeKategorier] = useState<
    string[]
  >([]);
  const [existingMålgruppeTemplates, setExistingMålgruppeTemplates] = useState<
    Målgruppe[]
  >([]);

  const [formData, setFormData] = useState<Tjeneste>(INITIAL_FORM_DATA);
  const tjenestetypeSuggestionsId = useId();
  const leverandørSuggestionsId = useId();
  const initialSnapshotRef = useRef<string>("");
  const formSnapshot = useMemo(() => JSON.stringify(formData), [formData]);
  const hasUnsavedChanges =
    initialSnapshotRef.current !== "" &&
    formSnapshot !== initialSnapshotRef.current &&
    !saving &&
    !success;
  const beskrivelseRichHtml = useMemo(
    () =>
      resolveRichHtml({
        beskrivelse: formData.beskrivelse,
        beskrivelse_plain_text: formData.beskrivelse_plain_text,
        beskrivelse_rich_base64: formData.beskrivelse_rich_base64,
      }),
    [
      formData.beskrivelse,
      formData.beskrivelse_plain_text,
      formData.beskrivelse_rich_base64,
    ]
  );
  const forDuSokerRichHtml = useMemo(
    () =>
      resolveRichHtmlFromLegacyArray({
        plain_text: formData.for_du_søker_plain_text,
        rich_base64: formData.for_du_søker_rich_base64,
        legacy_array: formData.for_du_søker,
      }),
    [
      formData.for_du_søker_plain_text,
      formData.for_du_søker_rich_base64,
      formData.for_du_søker,
    ]
  );
  const tildelingskriterierRichHtml = useMemo(
    () =>
      resolveRichHtmlFromLegacyArray({
        plain_text: formData.tildelingskriterier_plain_text,
        rich_base64: formData.tildelingskriterier_rich_base64,
        legacy_array: formData.tildelingskriterier,
      }),
    [
      formData.tildelingskriterier_plain_text,
      formData.tildelingskriterier_rich_base64,
      formData.tildelingskriterier,
    ]
  );
  const detteInngårIkkeITjenestetilbudetRichHtml = useMemo(
    () =>
      resolveRichHtmlFromLegacyArray({
        plain_text: formData.dette_inngår_ikke_i_tjenestetilbudet_plain_text,
        rich_base64: formData.dette_inngår_ikke_i_tjenestetilbudet_rich_base64,
        legacy_array: formData.dette_inngår_ikke_i_tjenestetilbudet,
      }),
    [
      formData.dette_inngår_ikke_i_tjenestetilbudet_plain_text,
      formData.dette_inngår_ikke_i_tjenestetilbudet_rich_base64,
      formData.dette_inngår_ikke_i_tjenestetilbudet,
    ]
  );
  const hvaKanDuForventeRichHtml = useMemo(
    () =>
      resolveRichHtmlFromLegacyArray({
        plain_text: formData.hva_kan_du_forvente_plain_text,
        rich_base64: formData.hva_kan_du_forvente_rich_base64,
        legacy_array: formData.hva_kan_du_forvente,
      }),
    [
      formData.hva_kan_du_forvente_plain_text,
      formData.hva_kan_du_forvente_rich_base64,
      formData.hva_kan_du_forvente,
    ]
  );
  const forventningerTilBrukerRichHtml = useMemo(
    () =>
      resolveRichHtmlFromLegacyArray({
        plain_text: formData.forventninger_til_bruker_plain_text,
        rich_base64: formData.forventninger_til_bruker_rich_base64,
        legacy_array: formData.forventninger_til_bruker,
      }),
    [
      formData.forventninger_til_bruker_plain_text,
      formData.forventninger_til_bruker_rich_base64,
      formData.forventninger_til_bruker,
    ]
  );

  async function loadTjeneste() {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const data = await fetchTjenesteById(id);
      const normalizedBeskrivelse = normalizeBeskrivelseRepresentations(data);
      const normalizedLegacyRichText = normalizeLegacyRichTextFields(data);
      const normalized: Tjeneste = {
        ...data,
        ...normalizedBeskrivelse,
        ...normalizedLegacyRichText,
        trinn_nivå: data.trinn_nivå || (data.vedtaksbasert ? "trinn1" : "grunnmur"),
      };
      setFormData(normalized);
      initialSnapshotRef.current = JSON.stringify(normalized);
    } catch (err: any) {
      setError(err.message || "Kunne ikke laste tjeneste");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isEdit && id) {
      loadTjeneste();
    } else {
      setLoading(false);
      initialSnapshotRef.current = JSON.stringify(INITIAL_FORM_DATA);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEdit]);

  useEffect(() => {
    let active = true;

    async function loadExistingCategories() {
      try {
        const allTjenester = await fetchTjenester();
        if (!active) {
          return;
        }

        const unique = Array.from(
          new Set(
            allTjenester
              .flatMap((tjeneste) => tjeneste.kategori_sti || [])
              .map((kategori) => kategori.trim())
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b, "nb"));

        const uniqueTjenestetyper = Array.from(
          new Set(
            allTjenester
              .map((tjeneste) => tjeneste.tjenestetype?.trim())
              .filter((tjenestetype): tjenestetype is string => Boolean(tjenestetype))
          )
        ).sort((a, b) => a.localeCompare(b, "nb"));

        const uniqueLeverandører = Array.from(
          new Set(
            allTjenester
              .flatMap((tjeneste) => tjeneste.leverandør_organisasjoner || [])
              .map((leverandør) => leverandør.trim())
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b, "nb"));

        const målgruppeMap = new Map<string, Målgruppe>();
        for (const målgruppe of allTjenester.flatMap((tjeneste) => tjeneste.målgruppe || [])) {
          const beskrivelse = målgruppe.beskrivelse.trim();
          if (!beskrivelse) {
            continue;
          }
          const key = beskrivelse.toLowerCase();
          if (målgruppeMap.has(key)) {
            continue;
          }
          målgruppeMap.set(key, {
            beskrivelse,
            kategorier: normalizeStringArray(målgruppe.kategorier || []),
            alder_fra: målgruppe.alder_fra ?? null,
            alder_til: målgruppe.alder_til ?? null,
          });
        }

        const uniqueMålgruppeTemplates = Array.from(målgruppeMap.values()).sort((a, b) =>
          a.beskrivelse.localeCompare(b.beskrivelse, "nb")
        );
        const uniqueMålgruppeNavn = uniqueMålgruppeTemplates.map(
          (målgruppe) => målgruppe.beskrivelse
        );
        const uniqueMålgruppeKategorier = Array.from(
          new Set(
            uniqueMålgruppeTemplates
              .flatMap((målgruppe) => målgruppe.kategorier || [])
              .map((kategori) => kategori.trim())
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b, "nb"));

        setExistingCategories(unique);
        setExistingTjenestetyper(uniqueTjenestetyper);
        setExistingLeverandører(uniqueLeverandører);
        setExistingMålgruppeNavn(uniqueMålgruppeNavn);
        setExistingMålgruppeKategorier(uniqueMålgruppeKategorier);
        setExistingMålgruppeTemplates(uniqueMålgruppeTemplates);
      } catch {
        // Keep form usable even if category suggestions fail to load.
      }
    }

    void loadExistingCategories();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  function updateField<K extends keyof Tjeneste>(field: K, value: Tjeneste[K]) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function updateBeskrivelseFromRichHtml(richHtml: string) {
    const plainText = stripRichTextToPlainText(richHtml);
    setFormData((prev) => ({
      ...prev,
      beskrivelse: plainText,
      beskrivelse_plain_text: plainText,
      beskrivelse_rich_base64: encodeUtf8ToBase64(richHtml),
    }));
  }

  function updateLegacyRichTextFieldFromHtml(
    field:
      | "for_du_søker"
      | "tildelingskriterier"
      | "dette_inngår_ikke_i_tjenestetilbudet"
      | "hva_kan_du_forvente"
      | "forventninger_til_bruker",
    plainField:
      | "for_du_søker_plain_text"
      | "tildelingskriterier_plain_text"
      | "dette_inngår_ikke_i_tjenestetilbudet_plain_text"
      | "hva_kan_du_forvente_plain_text"
      | "forventninger_til_bruker_plain_text",
    richField:
      | "for_du_søker_rich_base64"
      | "tildelingskriterier_rich_base64"
      | "dette_inngår_ikke_i_tjenestetilbudet_rich_base64"
      | "hva_kan_du_forvente_rich_base64"
      | "forventninger_til_bruker_rich_base64",
    richHtml: string
  ) {
    const plainText = stripRichTextToPlainText(richHtml);
    setFormData((prev) => ({
      ...prev,
      [field]: plainText.trim() ? [plainText] : undefined,
      [plainField]: plainText,
      [richField]: encodeUtf8ToBase64(richHtml),
    }));
  }

  function updateForDuSokerFromRichHtml(richHtml: string) {
    updateLegacyRichTextFieldFromHtml(
      "for_du_søker",
      "for_du_søker_plain_text",
      "for_du_søker_rich_base64",
      richHtml
    );
  }

  function updateTildelingskriterierFromRichHtml(richHtml: string) {
    updateLegacyRichTextFieldFromHtml(
      "tildelingskriterier",
      "tildelingskriterier_plain_text",
      "tildelingskriterier_rich_base64",
      richHtml
    );
  }

  function updateHvaKanDuForventeFromRichHtml(richHtml: string) {
    updateLegacyRichTextFieldFromHtml(
      "hva_kan_du_forvente",
      "hva_kan_du_forvente_plain_text",
      "hva_kan_du_forvente_rich_base64",
      richHtml
    );
  }

  function updateDetteInngårIkkeITjenestetilbudetFromRichHtml(richHtml: string) {
    updateLegacyRichTextFieldFromHtml(
      "dette_inngår_ikke_i_tjenestetilbudet",
      "dette_inngår_ikke_i_tjenestetilbudet_plain_text",
      "dette_inngår_ikke_i_tjenestetilbudet_rich_base64",
      richHtml
    );
  }

  function updateForventningerTilBrukerFromRichHtml(richHtml: string) {
    updateLegacyRichTextFieldFromHtml(
      "forventninger_til_bruker",
      "forventninger_til_bruker_plain_text",
      "forventninger_til_bruker_rich_base64",
      richHtml
    );
  }

  function addArrayItem(field: keyof Tjeneste, item: any) {
    setFormData((prev) => ({
      ...prev,
      [field]: [...((prev[field] as any[]) || []), item],
    }));
  }

  function removeArrayItem(field: keyof Tjeneste, index: number) {
    setFormData((prev) => {
      const arr = [...((prev[field] as any[]) || [])];
      arr.splice(index, 1);
      return { ...prev, [field]: arr };
    });
  }

  function updateArrayItem(field: keyof Tjeneste, index: number, value: any) {
    setFormData((prev) => {
      const arr = [...((prev[field] as any[]) || [])];
      arr[index] = value;
      return { ...prev, [field]: arr };
    });
  }

  function updateStringArrayItem(
    field: keyof Tjeneste,
    index: number,
    value: string
  ) {
    setFormData((prev) => {
      const arr = [...((prev[field] as string[]) || [])];
      arr[index] = value;
      return { ...prev, [field]: arr };
    });
  }

  function addStringToArray(field: keyof Tjeneste, value: string) {
    if (!value.trim()) return;
    setFormData((prev) => ({
      ...prev,
      [field]: [...((prev[field] as string[]) || []), value.trim()],
    }));
  }

  function handleVedtaksbasertChange(enabled: boolean) {
    setFormData((prev) => ({
      ...prev,
      vedtaksbasert: enabled,
      lavterskel: !enabled,
      trinn_nivå: enabled
        ? prev.trinn_nivå === "grunnmur"
          ? "trinn1"
          : prev.trinn_nivå
        : "grunnmur",
      vedtak: enabled
        ? prev.vedtak ?? {
            krever_søknad: false,
            søknadsvei: "",
          }
        : undefined,
    }));
  }

  function handleLavterskelChange(enabled: boolean) {
    setFormData((prev) => {
      if (enabled) {
        return {
          ...prev,
          lavterskel: true,
          vedtaksbasert: false,
          trinn_nivå: "grunnmur",
          vedtak: undefined,
        };
      }
      return {
        ...prev,
        lavterskel: false,
        vedtaksbasert: true,
        trinn_nivå: prev.trinn_nivå === "grunnmur" ? "trinn1" : prev.trinn_nivå,
        vedtak:
          prev.vedtak ?? {
            krever_søknad: false,
            søknadsvei: "",
          },
      };
    });
  }

  function handleTrinnNivåChange(value: TrinnNiva) {
    const isVedtaksbasert = value !== "grunnmur";
    setFormData((prev) => ({
      ...prev,
      trinn_nivå: value,
      vedtaksbasert: isVedtaksbasert,
      lavterskel: !isVedtaksbasert,
      vedtak: isVedtaksbasert
        ? prev.vedtak ?? {
            krever_søknad: false,
            søknadsvei: "",
          }
        : undefined,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const normalizedBeskrivelse = normalizeBeskrivelseRepresentations(formData);
      const normalizedLegacyRichText = normalizeLegacyRichTextFields(formData);
      if (!normalizedBeskrivelse.beskrivelse.trim()) {
        setError("Beskrivelse er påkrevd.");
        return;
      }

      const normalizedTrinn = formData.vedtaksbasert
        ? formData.trinn_nivå === "grunnmur"
          ? "trinn1"
          : formData.trinn_nivå
        : "grunnmur";

      const payload: Tjeneste = {
        ...formData,
        ...normalizedBeskrivelse,
        ...normalizedLegacyRichText,
        trinn_nivå: normalizedTrinn,
        vedtaksbasert: normalizedTrinn !== "grunnmur",
        lavterskel: normalizedTrinn === "grunnmur",
        vedtak:
          normalizedTrinn === "grunnmur"
            ? undefined
            : formData.vedtak ?? {
                krever_søknad: false,
                søknadsvei: "",
              },
      };

      if (isEdit && id) {
        await updateTjeneste(id, payload);
      } else {
        await createTjeneste(payload);
      }
      setSuccess(true);
      initialSnapshotRef.current = JSON.stringify(payload);
      setTimeout(() => {
        navigate("/");
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Kunne ikke lagre tjeneste");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--color-primary)] mb-4"></div>
        <div className="text-[var(--color-text-muted)] font-medium">Laster tjeneste...</div>
      </div>
    );
  }

  function handleNavigateBack() {
    if (
      hasUnsavedChanges &&
      !confirm("Du har ulagrede endringer. Er du sikker på at du vil gå tilbake?")
    ) {
      return;
    }
    navigate("/");
  }

  const hasPriceCost =
    formData.pris?.betalingstype !== undefined &&
    formData.pris.betalingstype !== "gratis";

  const leverandørNavn = formData.leverandør_organisasjoner?.[0] || "";

  function getKontaktpunkt(type: Kontaktpunkt["type"]) {
    return formData.kontaktpunkter?.find((kp) => kp.type === type);
  }

  function getKontaktVerdi(type: Kontaktpunkt["type"]) {
    return getKontaktpunkt(type)?.verdi || "";
  }

  function getTelefonÅpningstid() {
    return getKontaktpunkt("telefon")?.åpningstid || "";
  }

  function setKontaktVerdi(type: "telefon" | "epost" | "nettside", rawValue: string) {
    const value = rawValue.trim();
    const current = [...(formData.kontaktpunkter || [])];
    const idx = current.findIndex((kp) => kp.type === type);
    const existing = idx >= 0 ? current[idx] : undefined;

    if (!value) {
      if (idx >= 0 && !(type === "telefon" && existing?.åpningstid?.trim())) {
        current.splice(idx, 1);
      } else if (idx >= 0) {
        current[idx] = { ...existing, verdi: "" } as Kontaktpunkt;
      }
      updateField("kontaktpunkter", current.length > 0 ? current : undefined);
      return;
    }

    const defaultBeskrivelse =
      type === "telefon" ? "Telefon" : type === "epost" ? "E-post" : "Nettside";

    if (idx >= 0) {
      current[idx] = { ...current[idx], verdi: value };
    } else {
      current.push({
        type,
        beskrivelse: defaultBeskrivelse,
        verdi: value,
      });
    }

    updateField("kontaktpunkter", current);
  }

  function setTelefonÅpningstid(rawValue: string) {
    const value = rawValue;
    const hasOpeningstid = value.trim().length > 0;
    const current = [...(formData.kontaktpunkter || [])];
    const idx = current.findIndex((kp) => kp.type === "telefon");
    const existing = idx >= 0 ? current[idx] : undefined;
    const hasTelefon = Boolean(existing?.verdi?.trim());

    if (!hasOpeningstid && !hasTelefon) {
      if (idx >= 0) {
        current.splice(idx, 1);
      }
      updateField("kontaktpunkter", current.length > 0 ? current : undefined);
      return;
    }

    if (idx >= 0) {
      current[idx] = {
        ...current[idx],
        beskrivelse: current[idx].beskrivelse || "Telefon",
        åpningstid: hasOpeningstid ? value : undefined,
      };
    } else {
      current.push({
        type: "telefon",
        beskrivelse: "Telefon",
        verdi: "",
        åpningstid: hasOpeningstid ? value : undefined,
      });
    }

    updateField("kontaktpunkter", current);
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold text-[var(--color-text)] mb-2">
            {isEdit ? "Rediger tjeneste" : "Ny tjeneste"}
          </h1>
          <p className="text-[var(--color-text-muted)]">
            {isEdit ? "Oppdater informasjon om tjenesten" : "Opprett en ny tjeneste i Tjenesteguide"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleNavigateBack}
            className="btn-secondary"
          >
            Tilbake til liste
          </button>
          {hasUnsavedChanges && (
            <div className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-sm font-semibold">
              Ulagrede endringer
            </div>
          )}
          <div className="badge badge-primary">
            {isEdit ? "Eksisterende tjeneste" : "Ny oppføring"}
          </div>
        </div>
      </div>

      {error && (
        <div className="card p-4 border-l-4 border-red-500 bg-red-50/80">
          <p className="text-red-800 font-medium">{error}</p>
        </div>
      )}

      {success && (
        <div className="card p-4 border-l-4 border-emerald-500 bg-emerald-50/80">
          <p className="text-green-800 font-medium">Tjeneste lagret! Omdirigerer...</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-7">
        {/* Grunninfo */}
        <Section title="Grunninfo">
          {isEdit && (
            <FormField label="ID">
              <input
                type="text"
                value={formData.id}
                disabled
                className="input-field bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">
                ID kan ikke endres etter opprettelse
              </p>
            </FormField>
          )}

          {!isEdit && (
            <FormField label="ID">
              <p className="text-xs text-gray-500 mt-1">
                ID tildeles automatisk ved lagring (6-sifret løpenummer).
              </p>
            </FormField>
          )}

          <FormField label="Navn *" required>
            <input
              type="text"
              value={formData.navn}
              onChange={(e) => updateField("navn", e.target.value)}
              required
              className="input-field"
            />
          </FormField>

          <FormField label="Kort navn">
            <input
              type="text"
              value={formData.kort_navn || ""}
              onChange={(e) =>
                updateField("kort_navn", e.target.value || undefined)
              }
              className="input-field"
            />
          </FormField>

          <FormField label="Synonymer">
            <StringArrayInput
              values={formData.synonymer || []}
              onAdd={(val) => addStringToArray("synonymer", val)}
              onRemove={(idx) => removeArrayItem("synonymer", idx)}
              onUpdate={(idx, val) => updateStringArrayItem("synonymer", idx, val)}
              placeholder="Legg til synonym"
            />
          </FormField>

          <FormField label="Tjenestetype *">
            <input
              type="text"
              value={formData.tjenestetype}
              onChange={(e) => updateField("tjenestetype", e.target.value)}
              list={
                existingTjenestetyper.length > 0
                  ? tjenestetypeSuggestionsId
                  : undefined
              }
              required
              className="input-field"
            />
            {existingTjenestetyper.length > 0 && (
              <>
                <datalist id={tjenestetypeSuggestionsId}>
                  {existingTjenestetyper.map((tjenestetype) => (
                    <option key={tjenestetype} value={tjenestetype} />
                  ))}
                </datalist>
                <div className="mt-2">
                  <p className="text-xs text-[var(--color-text-muted)] mb-2">
                    Velg fra eksisterende tjenestetyper:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {existingTjenestetyper.slice(0, 8).map((tjenestetype) => (
                      <button
                        key={tjenestetype}
                        type="button"
                        onClick={() => updateField("tjenestetype", tjenestetype)}
                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-[rgba(99,91,255,0.14)] text-[var(--color-primary)] hover:bg-[rgba(99,91,255,0.22)] transition-colors"
                      >
                        {tjenestetype}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </FormField>

          <FormField label="Trinnnivå *">
            <div
              role="radiogroup"
              aria-label="Trinnnivå"
              className="flex flex-wrap gap-2"
            >
              {TRINN_OPTIONS.map((option) => {
                const isActive = formData.trinn_nivå === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => handleTrinnNivåChange(option.value)}
                    className={`px-3.5 py-2 rounded-full text-sm font-semibold border transition-colors ${
                      isActive
                        ? "bg-[rgba(99,91,255,0.14)] border-[var(--color-primary)] text-[var(--color-primary)]"
                        : "bg-white border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-text)]"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </FormField>

          <div className="flex gap-6">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.vedtaksbasert}
                onChange={(e) => handleVedtaksbasertChange(e.target.checked)}
                className="mr-2 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
              />
              Vedtaksbasert
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.lavterskel}
                onChange={(e) => handleLavterskelChange(e.target.checked)}
                className="mr-2 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
              />
              Lavterskel
            </label>
          </div>

          <FormField label="Status *">
            <div
              role="radiogroup"
              aria-label="Status"
              className="flex flex-wrap gap-2"
            >
              {(
                [
                  { value: "aktiv", label: "Aktiv" },
                  { value: "planlagt", label: "Planlagt" },
                  { value: "utgår", label: "Utgår" },
                ] as const
              ).map((option) => {
                const isActive = formData.status === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => updateField("status", option.value)}
                    className={`px-3.5 py-2 rounded-full text-sm font-semibold border transition-colors ${
                      isActive
                        ? "bg-[rgba(99,91,255,0.14)] border-[var(--color-primary)] text-[var(--color-primary)]"
                        : "bg-white border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-text)]"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </FormField>
        </Section>

        {/* Kategorier */}
        <Section title="Kategorier">
          <FormField label="Kategorier">
            <StringArrayInput
              values={formData.kategori_sti}
              onAdd={(val) => {
                const next = [...formData.kategori_sti, val.trim()];
                updateField("kategori_sti", next);
                updateField("temaer", next);
              }}
              onRemove={(idx) => {
                const next = [...formData.kategori_sti];
                next.splice(idx, 1);
                updateField("kategori_sti", next);
                updateField("temaer", next);
              }}
              onUpdate={(idx, val) => {
                const next = [...formData.kategori_sti];
                next[idx] = val;
                updateField("kategori_sti", next);
                updateField("temaer", next);
              }}
              placeholder="Velg eller opprett kategori"
              suggestions={existingCategories}
              suggestionsLabel="Velg fra eksisterende kategorier:"
            />
          </FormField>
        </Section>

        {/* Målgruppe */}
        <MålgruppeSection
          målgrupper={formData.målgruppe || []}
          onAdd={(målgruppe) => addArrayItem("målgruppe", målgruppe)}
          onUpdate={(idx, målgruppe) => updateArrayItem("målgruppe", idx, målgruppe)}
          onRemove={(idx) => removeArrayItem("målgruppe", idx)}
          existingNames={existingMålgruppeNavn}
          existingCategories={existingMålgruppeKategorier}
          existingTemplates={existingMålgruppeTemplates}
        />

        {/* Organisering */}
        <Section title="Organisering">
          <FormField label="Leverandør type">
            <select
              value={formData.leverandør_type || ""}
              onChange={(e) =>
                updateField(
                  "leverandør_type",
                  (e.target.value || undefined) as Tjeneste["leverandør_type"]
                )
              }
              className="input-field"
            >
              <option value="">Velg...</option>
              <option value="kommunal">Kommunal</option>
              <option value="frivillig">Frivillig</option>
              <option value="statlig">Statlig</option>
              <option value="privat">Privat</option>
              <option value="samarbeid">Samarbeid</option>
            </select>
          </FormField>

          <FormField label="Leverandør">
            <input
              type="text"
              value={leverandørNavn}
              onChange={(e) =>
                updateField(
                  "leverandør_organisasjoner",
                  e.target.value.trim() ? [e.target.value] : undefined
                )
              }
              list={
                existingLeverandører.length > 0 ? leverandørSuggestionsId : undefined
              }
              placeholder="Navn på leverandør"
              className="input-field"
            />
            {existingLeverandører.length > 0 && (
              <>
                <datalist id={leverandørSuggestionsId}>
                  {existingLeverandører.map((leverandør) => (
                    <option key={leverandør} value={leverandør} />
                  ))}
                </datalist>
                <div className="mt-2">
                  <p className="text-xs text-[var(--color-text-muted)] mb-2">
                    Velg fra eksisterende leverandører:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {existingLeverandører.slice(0, 8).map((leverandør) => (
                      <button
                        key={leverandør}
                        type="button"
                        onClick={() =>
                          updateField("leverandør_organisasjoner", [leverandør])
                        }
                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-[rgba(99,91,255,0.14)] text-[var(--color-primary)] hover:bg-[rgba(99,91,255,0.22)] transition-colors"
                      >
                        {leverandør}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </FormField>

          <FormField label="Kontakt e-post">
            <input
              type="email"
              value={getKontaktVerdi("epost")}
              onChange={(e) => setKontaktVerdi("epost", e.target.value)}
              placeholder="kontakt@eksempel.no"
              className="input-field"
            />
          </FormField>

          <FormField label="Kontakt telefon">
            <input
              type="text"
              value={getKontaktVerdi("telefon")}
              onChange={(e) => setKontaktVerdi("telefon", e.target.value)}
              placeholder="+47 ..."
              className="input-field"
            />
          </FormField>

          <FormField label="Telefon åpningstid">
            <textarea
              value={getTelefonÅpningstid()}
              onChange={(e) => setTelefonÅpningstid(e.target.value)}
              rows={4}
              placeholder={"F.eks.\nMandag-fredag: 08:00-15:30\nKveld: 18:00-20:00\nHelg: stengt"}
              className="input-field"
            />
            <p className="text-xs text-[var(--color-text-subtle)] mt-2">
              Fleksibel fritekst. Du kan skrive dagtid, kveld, helg eller andre varianter.
            </p>
          </FormField>

          <FormField label="Nettside">
            <input
              type="url"
              value={getKontaktVerdi("nettside")}
              onChange={(e) => setKontaktVerdi("nettside", e.target.value)}
              placeholder="https://..."
              className="input-field"
            />
          </FormField>
        </Section>

        {/* Geografi */}
        <Section title="Geografi">
          <FormField label="Kommune">
            <input
              type="text"
              value={formData.geografi?.kommune || ""}
              onChange={(e) =>
                updateField("geografi", {
                  ...formData.geografi,
                  kommune: e.target.value,
                  områder: formData.geografi?.områder || [],
                })
              }
              className="input-field"
            />
          </FormField>

          <FormField label="Områder">
            <StringArrayInput
              values={formData.geografi?.områder || []}
              onAdd={(val) =>
                updateField("geografi", {
                  ...formData.geografi,
                  kommune: formData.geografi?.kommune || "",
                  områder: [...(formData.geografi?.områder || []), val.trim()],
                })
              }
              onRemove={(idx) => {
                const områder = [...(formData.geografi?.områder || [])];
                områder.splice(idx, 1);
                updateField("geografi", {
                  ...formData.geografi,
                  kommune: formData.geografi?.kommune || "",
                  områder,
                });
              }}
              onUpdate={(idx, val) => {
                const områder = [...(formData.geografi?.områder || [])];
                områder[idx] = val;
                updateField("geografi", {
                  ...formData.geografi,
                  kommune: formData.geografi?.kommune || "",
                  områder,
                });
              }}
              placeholder="Legg til område"
            />
          </FormField>
        </Section>

        {/* Innhold og kriterier */}
        <Section title="Innhold og kriterier">
          <FormField label="Beskrivelse" required>
            <RichTextEditor
              value={beskrivelseRichHtml}
              onChange={updateBeskrivelseFromRichHtml}
              required
              placeholder="Skriv en rik beskrivelse..."
            />
            <p className="text-xs text-[var(--color-text-subtle)] mt-2">
              Lagrer både riktekst (Base64) og ren tekst for søk.
            </p>
          </FormField>

          <FormField label="Før du søker">
            <RichTextEditor
              value={forDuSokerRichHtml}
              onChange={updateForDuSokerFromRichHtml}
              placeholder="Skriv informasjon før du søker..."
            />
            <p className="text-xs text-[var(--color-text-subtle)] mt-2">
              Lagrer både riktekst (Base64) og ren tekst for søk.
            </p>
          </FormField>

          <FormField label="Tildelingskriterier">
            <RichTextEditor
              value={tildelingskriterierRichHtml}
              onChange={updateTildelingskriterierFromRichHtml}
              placeholder="Skriv tildelingskriterier..."
            />
            <p className="text-xs text-[var(--color-text-subtle)] mt-2">
              Lagrer både riktekst (Base64) og ren tekst for søk.
            </p>
          </FormField>

          <FormField label="Dette inngår ikke i tjenestetilbudet">
            <RichTextEditor
              value={detteInngårIkkeITjenestetilbudetRichHtml}
              onChange={updateDetteInngårIkkeITjenestetilbudetFromRichHtml}
              placeholder="Skriv hva som ikke inngår i tjenestetilbudet..."
            />
            <p className="text-xs text-[var(--color-text-subtle)] mt-2">
              Lagrer både riktekst (Base64) og ren tekst for søk.
            </p>
          </FormField>

          <FormField label="Særlige varianter">
            <textarea
              value={(formData.særlige_varianter || [])
                .map((variant) =>
                  variant.ekstra_kriterier?.length
                    ? `${variant.navn} (${variant.ekstra_kriterier.join(", ")})`
                    : variant.navn
                )
                .join("\n")}
              onChange={(e) => {
                const lines = e.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean);
                updateField(
                  "særlige_varianter",
                  lines.length > 0
                    ? lines.map((line) => ({
                        navn: line,
                        ekstra_kriterier: [],
                      }))
                    : undefined
                );
              }}
              rows={6}
              placeholder="Skriv én variant per linje..."
              className="input-field"
            />
          </FormField>
        </Section>

        {/* Vedtak */}
        <Section title="Vedtak">
          {!formData.vedtaksbasert ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Aktiver <span className="font-semibold">Vedtaksbasert</span> i Grunninfo
              for å redigere vedtaksinformasjon.
            </p>
          ) : (
            <>
              <label className="flex items-center mb-4">
                <input
                  type="checkbox"
                  checked={formData.vedtak?.krever_søknad || false}
                  onChange={(e) =>
                    updateField("vedtak", {
                      ...formData.vedtak,
                      krever_søknad: e.target.checked,
                      søknadsvei: formData.vedtak?.søknadsvei || "",
                    })
                  }
                  className="mr-2 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                />
                Krever søknad
              </label>

              <FormField label="Søknadsvei">
                <input
                  type="text"
                  value={formData.vedtak?.søknadsvei || ""}
                  onChange={(e) =>
                    updateField("vedtak", {
                      ...formData.vedtak,
                      krever_søknad: formData.vedtak?.krever_søknad || false,
                      søknadsvei: e.target.value,
                    })
                  }
                  className="input-field"
                />
              </FormField>

              <FormField label="Søknad URL">
                <input
                  type="url"
                  value={formData.vedtak?.søknad_url || ""}
                  onChange={(e) =>
                    updateField("vedtak", {
                      ...formData.vedtak,
                      krever_søknad: formData.vedtak?.krever_søknad || false,
                      søknadsvei: formData.vedtak?.søknadsvei || "",
                      søknad_url: e.target.value || undefined,
                    })
                  }
                  className="input-field"
                />
              </FormField>

              <FormField label="Korte punkter">
                <StringArrayInput
                  values={formData.vedtak?.korte_punkter || []}
                  onAdd={(val) =>
                    updateField("vedtak", {
                      ...formData.vedtak,
                      krever_søknad: formData.vedtak?.krever_søknad || false,
                      søknadsvei: formData.vedtak?.søknadsvei || "",
                      korte_punkter: [
                        ...(formData.vedtak?.korte_punkter || []),
                        val.trim(),
                      ],
                    })
                  }
                  onRemove={(idx) => {
                    const punkter = [...(formData.vedtak?.korte_punkter || [])];
                    punkter.splice(idx, 1);
                    updateField("vedtak", {
                      ...formData.vedtak,
                      krever_søknad: formData.vedtak?.krever_søknad || false,
                      søknadsvei: formData.vedtak?.søknadsvei || "",
                      korte_punkter: punkter,
                    });
                  }}
                  onUpdate={(idx, val) => {
                    const punkter = [...(formData.vedtak?.korte_punkter || [])];
                    punkter[idx] = val;
                    updateField("vedtak", {
                      ...formData.vedtak,
                      krever_søknad: formData.vedtak?.krever_søknad || false,
                      søknadsvei: formData.vedtak?.søknadsvei || "",
                      korte_punkter: punkter,
                    });
                  }}
                  placeholder="Legg til punkt"
                />
              </FormField>
            </>
          )}
        </Section>

        {/* Hva kan du forvente / forventninger */}
        <Section title="Hva kan du forvente / Forventninger">
          <FormField label="Hva kan du forvente">
            <RichTextEditor
              value={hvaKanDuForventeRichHtml}
              onChange={updateHvaKanDuForventeFromRichHtml}
              placeholder="Skriv hva brukeren kan forvente..."
            />
            <p className="text-xs text-[var(--color-text-subtle)] mt-2">
              Lagrer både riktekst (Base64) og ren tekst for søk.
            </p>
          </FormField>

          <FormField label="Forventninger til bruker">
            <RichTextEditor
              value={forventningerTilBrukerRichHtml}
              onChange={updateForventningerTilBrukerFromRichHtml}
              placeholder="Skriv forventninger til bruker..."
            />
            <p className="text-xs text-[var(--color-text-subtle)] mt-2">
              Lagrer både riktekst (Base64) og ren tekst for søk.
            </p>
          </FormField>
        </Section>

        {/* Evaluering */}
        <Section title="Evaluering">
          <FormField label="Frekvens">
            <input
              type="text"
              value={formData.evaluering?.frekvens || ""}
              onChange={(e) =>
                updateField("evaluering", {
                  ...formData.evaluering,
                  frekvens: e.target.value || undefined,
                  spørsmål: formData.evaluering?.spørsmål || [],
                })
              }
              className="input-field"
            />
          </FormField>

          <FormField label="Spørsmål">
            <textarea
              value={(formData.evaluering?.spørsmål || []).join("\n\n")}
              onChange={(e) => {
                const value = e.target.value;
                updateField("evaluering", {
                  ...formData.evaluering,
                  frekvens: formData.evaluering?.frekvens,
                  spørsmål: value.trim() ? [value] : undefined,
                });
              }}
              rows={6}
              placeholder="Skriv evalueringsspørsmål..."
              className="input-field"
            />
          </FormField>
        </Section>

        {/* Pris */}
        <Section title="Pris">
          <FormField label="Betalingstype">
            <select
              value={formData.pris?.betalingstype || ""}
              onChange={(e) => {
                const betalingstype = e.target.value as PrisInfo["betalingstype"] | "";
                if (!betalingstype) {
                  updateField("pris", undefined);
                  return;
                }
                updateField("pris", {
                  ...formData.pris,
                  betalingstype,
                  beskrivelse: formData.pris?.beskrivelse || "",
                  beløp: betalingstype === "gratis" ? undefined : formData.pris?.beløp,
                });
              }}
              className="input-field"
            >
              <option value="">Velg...</option>
              <option value="egenandel">Egenandel</option>
              <option value="gratis">Gratis</option>
              <option value="full_pris">Full pris</option>
              <option value="annet">Annet</option>
            </select>
          </FormField>

          {hasPriceCost && (
            <FormField label="Beløp (NOK)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={formData.pris?.beløp ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  updateField("pris", {
                    ...formData.pris,
                    betalingstype: (formData.pris?.betalingstype || "annet") as PrisInfo["betalingstype"],
                    beskrivelse: formData.pris?.beskrivelse || "",
                    beløp: value === "" ? undefined : Number(value),
                    prislenke: formData.pris?.prislenke,
                  });
                }}
                placeholder="f.eks. 350"
                className="input-field"
              />
            </FormField>
          )}

          <FormField label="Beskrivelse">
            <textarea
              value={formData.pris?.beskrivelse || ""}
              onChange={(e) =>
                updateField("pris", {
                  ...formData.pris,
                  betalingstype: formData.pris?.betalingstype || "gratis",
                  beskrivelse: e.target.value,
                  beløp: formData.pris?.beløp,
                })
              }
              rows={3}
              className="input-field"
            />
          </FormField>

          <FormField label="Prislenke">
            <input
              type="url"
              value={formData.pris?.prislenke || ""}
              onChange={(e) =>
                updateField("pris", {
                  ...formData.pris,
                  betalingstype: formData.pris?.betalingstype || "gratis",
                  beskrivelse: formData.pris?.beskrivelse || "",
                  beløp: formData.pris?.beløp,
                  prislenke: e.target.value || undefined,
                })
              }
              className="input-field"
            />
          </FormField>
        </Section>

        {/* Lovhjemmel */}
        <LovhjemmelSection
          lovhjemler={formData.lovhjemmel || []}
          onAdd={(lh) => addArrayItem("lovhjemmel", lh)}
          onUpdate={(idx, lh) => updateArrayItem("lovhjemmel", idx, lh)}
          onRemove={(idx) => removeArrayItem("lovhjemmel", idx)}
        />

        {/* Eksterne lenker */}
        <EksternLenkeSection
          lenker={formData.eksterne_lenker || []}
          onAdd={(lenke) => addArrayItem("eksterne_lenker", lenke)}
          onUpdate={(idx, lenke) => updateArrayItem("eksterne_lenker", idx, lenke)}
          onRemove={(idx) => removeArrayItem("eksterne_lenker", idx)}
        />

        {/* Interne notater */}
        <Section title="Interne notater">
          <FormField label="Notater">
            <textarea
              value={(formData.interne_notater || []).join("\n\n")}
              onChange={(e) => {
                const value = e.target.value;
                updateField("interne_notater", value.trim() ? [value] : undefined);
              }}
              rows={8}
              placeholder="Skriv interne notater..."
              className="input-field"
            />
          </FormField>
        </Section>

        {/* Form actions */}
        <div className="sticky bottom-4 z-20 card p-5 backdrop-blur-sm">
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {saving ? "Lagrer..." : "Lagre"}
            </button>
            <button
              type="button"
              onClick={handleNavigateBack}
              className="btn-secondary"
            >
              Avbryt
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// Helper components
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-6 space-y-5">
      <h2 className="text-lg font-bold text-[var(--color-text)] border-b border-[var(--color-border)] pb-3 flex items-center gap-2">
        {title}
      </h2>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[var(--color-text-muted)] mb-2">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

function StringArrayInput({
  values,
  onAdd,
  onRemove,
  onUpdate,
  placeholder,
  suggestions = [],
  suggestionsLabel = "Velg fra eksisterende verdier:",
}: {
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, value: string) => void;
  placeholder?: string;
  suggestions?: string[];
  suggestionsLabel?: string;
}) {
  const [inputValue, setInputValue] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [inputFeedback, setInputFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const successTimeoutRef = useRef<number | null>(null);
  const suggestionsId = useId();

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current !== null) {
        window.clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const normalizedValues = new Set(values.map((value) => value.trim().toLowerCase()));
  const availableSuggestions = suggestions
    .filter((suggestion) => !normalizedValues.has(suggestion.trim().toLowerCase()))
    .slice(0, 24);

  function addValue(value: string): "added" | "empty" | "duplicate" {
    const trimmed = value.trim();
    if (!trimmed) return "empty";
    if (normalizedValues.has(trimmed.toLowerCase())) return "duplicate";
    onAdd(trimmed);
    setInputValue("");
    setInputFeedback({ type: "success", message: "Lagt til." });
    if (successTimeoutRef.current !== null) {
      window.clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = window.setTimeout(() => {
      setInputFeedback((current) =>
        current?.type === "success" ? null : current
      );
      successTimeoutRef.current = null;
    }, 1400);
    return "added";
  }

  function handleAdd() {
    const result = addValue(inputValue);
    if (result === "added") {
      return;
    }
    if (result === "empty") {
      setInputFeedback({
        type: "error",
        message: "Skriv inn en verdi før du legger til.",
      });
    } else if (result === "duplicate") {
      setInputFeedback({
        type: "error",
        message: "Denne verdien er allerede lagt til.",
      });
    }
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        {values.map((value, idx) => (
          <div
            key={idx}
            className="group relative inline-flex items-center gap-2 bg-[var(--color-bg-alt)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 hover:bg-[var(--color-bg-soft)] transition-colors"
          >
            {editingIndex === idx ? (
              <input
                type="text"
                value={value}
                onChange={(e) => onUpdate(idx, e.target.value)}
                onBlur={() => setEditingIndex(null)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    setEditingIndex(null);
                  }
                }}
                autoFocus
                className="bg-white border border-[var(--color-border)] rounded px-2 py-1 text-sm w-32"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span
                  className="text-sm font-medium text-[var(--color-text)] cursor-pointer"
                  onClick={() => setEditingIndex(idx)}
                >
                  {value}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(idx)}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-lg leading-none font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Fjern"
                >
                  ×
                </button>
              </>
            )}
          </div>
        ))}
        <div className="flex gap-2 items-center">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (inputFeedback) {
                setInputFeedback(null);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || "Skriv og trykk Enter"}
            list={availableSuggestions.length > 0 ? suggestionsId : undefined}
            className="input-field w-48"
          />
          {availableSuggestions.length > 0 && (
            <datalist id={suggestionsId}>
              {availableSuggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          )}
          <button
            type="button"
            onClick={handleAdd}
            className="btn-secondary whitespace-nowrap text-sm"
          >
            Legg til
          </button>
        </div>
      </div>
      {inputFeedback && (
        <p
          className={`text-xs ${
            inputFeedback.type === "success"
              ? "text-emerald-700"
              : "text-amber-700"
          }`}
        >
          {inputFeedback.message}
        </p>
      )}
      {availableSuggestions.length > 0 && (
        <div>
          <p className="text-xs text-[var(--color-text-muted)] mb-2">{suggestionsLabel}</p>
          <div className="flex flex-wrap gap-2">
            {availableSuggestions.slice(0, 8).map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => addValue(suggestion)}
                className="px-2.5 py-1 rounded-full text-xs font-medium bg-[rgba(99,91,255,0.14)] text-[var(--color-primary)] hover:bg-[rgba(99,91,255,0.22)] transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
      {values.length === 0 && (
        <p className="text-sm text-[var(--color-text-subtle)] italic">
          Ingen elementer lagt til ennå. Skriv og trykk Enter eller klikk "Legg til"
        </p>
      )}
    </div>
  );
}

function normalizeStringArray(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
}

function MålgruppeSection({
  målgrupper,
  onAdd,
  onUpdate,
  onRemove,
  existingNames,
  existingCategories,
  existingTemplates,
}: {
  målgrupper: Målgruppe[];
  onAdd: (målgruppe: Målgruppe) => void;
  onUpdate: (idx: number, målgruppe: Målgruppe) => void;
  onRemove: (idx: number) => void;
  existingNames: string[];
  existingCategories: string[];
  existingTemplates: Målgruppe[];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState<string>("");
  const [formData, setFormData] = useState<Målgruppe>({
    beskrivelse: "",
    kategorier: [],
    alder_fra: null,
    alder_til: null,
  });
  const målgruppeNameSuggestionsId = useId();

  const mergedCategorySuggestions = useMemo(
    () =>
      Array.from(
        new Set([...DEFAULT_MÅLGRUPPE_KATEGORIER, ...existingCategories].map((v) => v.trim()))
      )
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "nb")),
    [existingCategories]
  );

  const selectableTemplates = useMemo(() => {
    const map = new Map<string, Målgruppe>();

    for (const målgruppe of [...existingTemplates, ...målgrupper]) {
      const beskrivelse = målgruppe.beskrivelse.trim();
      if (!beskrivelse) {
        continue;
      }
      const key = beskrivelse.toLowerCase();
      if (map.has(key)) {
        continue;
      }
      map.set(key, {
        beskrivelse,
        kategorier: normalizeStringArray(målgruppe.kategorier || []),
        alder_fra: målgruppe.alder_fra ?? null,
        alder_til: målgruppe.alder_til ?? null,
      });
    }

    return Array.from(map.values()).sort((a, b) =>
      a.beskrivelse.localeCompare(b.beskrivelse, "nb")
    );
  }, [existingTemplates, målgrupper]);

  function createEmptyMålgruppe(): Målgruppe {
    return {
      beskrivelse: "",
      kategorier: [],
      alder_fra: null,
      alder_til: null,
    };
  }

  function openModal(index?: number) {
    if (index !== undefined) {
      const målgruppe = målgrupper[index];
      setFormData({
        beskrivelse: målgruppe.beskrivelse || "",
        kategorier: [...(målgruppe.kategorier || [])],
        alder_fra: målgruppe.alder_fra ?? null,
        alder_til: målgruppe.alder_til ?? null,
      });
      setEditingIndex(index);
    } else {
      setFormData(createEmptyMålgruppe());
      setEditingIndex(null);
    }
    setSelectedTemplateIndex("");
    setFormError(null);
    setModalOpen(true);
  }

  function formatAlder(målgruppe: Målgruppe): string | null {
    const hasFrom = målgruppe.alder_fra !== null && målgruppe.alder_fra !== undefined;
    const hasTo = målgruppe.alder_til !== null && målgruppe.alder_til !== undefined;
    if (!hasFrom && !hasTo) {
      return null;
    }
    if (hasFrom && hasTo) {
      return `${målgruppe.alder_fra}-${målgruppe.alder_til} år`;
    }
    if (hasFrom) {
      return `${målgruppe.alder_fra}+ år`;
    }
    return `0-${målgruppe.alder_til} år`;
  }

  function handleSave() {
    const beskrivelse = formData.beskrivelse.trim();
    if (!beskrivelse) {
      setFormError("Beskrivelse er påkrevd.");
      return;
    }

    const alderFra =
      formData.alder_fra === null || formData.alder_fra === undefined
        ? null
        : Math.max(0, Math.floor(formData.alder_fra));
    const alderTil =
      formData.alder_til === null || formData.alder_til === undefined
        ? null
        : Math.max(0, Math.floor(formData.alder_til));

    if (alderFra !== null && alderTil !== null && alderFra > alderTil) {
      setFormError("Alder fra kan ikke være høyere enn alder til.");
      return;
    }

    const normalized: Målgruppe = {
      beskrivelse,
      alder_fra: alderFra,
      alder_til: alderTil,
      kategorier: normalizeStringArray(formData.kategorier || []),
    };

    if (!normalized.kategorier?.length) {
      delete normalized.kategorier;
    }
    if (editingIndex !== null) {
      onUpdate(editingIndex, normalized);
    } else {
      onAdd(normalized);
    }
    setModalOpen(false);
  }

  function applyTemplate(template: Målgruppe) {
    setFormData({
      beskrivelse: template.beskrivelse,
      kategorier: [...(template.kategorier || [])],
      alder_fra: template.alder_fra ?? null,
      alder_til: template.alder_til ?? null,
    });
    setFormError(null);
  }

  return (
    <Section title="Målgruppe">
      <div className="space-y-3">
        {målgrupper.map((målgruppe, idx) => {
          const alderText = formatAlder(målgruppe);
          return (
            <div
              key={idx}
              className="card p-4 border-l-4 border-[var(--color-primary)] hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => openModal(idx)}
            >
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 space-y-2">
                  <h4 className="font-semibold text-[var(--color-text)]">
                    {målgruppe.beskrivelse}
                  </h4>
                  {alderText && (
                    <p className="text-sm text-[var(--color-text-muted)]">
                      Alder: {alderText}
                    </p>
                  )}
                  {målgruppe.kategorier?.length && (
                    <div className="flex flex-wrap gap-2">
                      {(målgruppe.kategorier || []).map((kategori, kategoriIdx) => (
                        <span
                          key={`k-${kategoriIdx}-${kategori}`}
                          className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[rgba(99,91,255,0.14)] text-[var(--color-primary)]"
                        >
                          {kategori}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <DeleteActionButton
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(idx);
                  }}
                  label={`Slett målgruppe ${idx + 1}`}
                />
              </div>
            </div>
          );
        })}

        {målgrupper.length === 0 && (
          <p className="text-sm text-[var(--color-text-subtle)] italic">
            Ingen målgrupper lagt til ennå. Legg til en målgruppe med kategorier for
            gjenbruk.
          </p>
        )}

        <button
          type="button"
          onClick={() => openModal()}
          className="btn-secondary w-full"
        >
          Legg til målgruppe
        </button>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingIndex !== null ? "Rediger målgruppe" : "Ny målgruppe"}
      >
        <div className="space-y-4">
          {selectableTemplates.length > 0 && (
            <FormField label="Velg eksisterende målgruppe">
              <select
                value={selectedTemplateIndex}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedTemplateIndex(value);
                  if (value === "") {
                    return;
                  }
                  const template = selectableTemplates[Number(value)];
                  if (template) {
                    applyTemplate(template);
                  }
                }}
                className="input-field"
              >
                <option value="">Velg...</option>
                {selectableTemplates.map((template, idx) => (
                  <option key={`${template.beskrivelse}-${idx}`} value={idx}>
                    {template.beskrivelse}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          <FormField label="Beskrivelse *" required>
            <input
              type="text"
              value={formData.beskrivelse}
              onChange={(e) => setFormData({ ...formData, beskrivelse: e.target.value })}
              list={existingNames.length > 0 ? målgruppeNameSuggestionsId : undefined}
              placeholder="F.eks. Barn og unge med psykiske helseutfordringer"
              className="input-field"
              required
            />
            {existingNames.length > 0 && (
              <datalist id={målgruppeNameSuggestionsId}>
                {existingNames.slice(0, 40).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            )}
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Alder fra">
              <input
                type="number"
                min={0}
                value={formData.alder_fra ?? ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    alder_fra: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="F.eks. 13"
                className="input-field"
              />
            </FormField>
            <FormField label="Alder til">
              <input
                type="number"
                min={0}
                value={formData.alder_til ?? ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    alder_til: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="F.eks. 25"
                className="input-field"
              />
            </FormField>
          </div>

          <FormField label="Kategorier">
            <StringArrayInput
              values={formData.kategorier || []}
              onAdd={(val) =>
                setFormData({
                  ...formData,
                  kategorier: [...(formData.kategorier || []), val],
                })
              }
              onRemove={(idx) => {
                const kategorier = [...(formData.kategorier || [])];
                kategorier.splice(idx, 1);
                setFormData({ ...formData, kategorier });
              }}
              onUpdate={(idx, val) => {
                const kategorier = [...(formData.kategorier || [])];
                kategorier[idx] = val;
                setFormData({ ...formData, kategorier });
              }}
              placeholder="Velg eller opprett kategori"
              suggestions={mergedCategorySuggestions}
              suggestionsLabel="Velg fra eksisterende kategorier:"
            />
          </FormField>

          {formError && (
            <p className="text-sm text-amber-700">{formError}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleSave}
              className="btn-primary flex-1"
              disabled={!formData.beskrivelse.trim()}
            >
              Lagre
            </button>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="btn-secondary flex-1"
            >
              Avbryt
            </button>
          </div>
        </div>
      </Modal>
    </Section>
  );
}

function DeleteActionButton({
  onClick,
  label,
}: {
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="icon-btn icon-btn-danger ml-4"
      title={label}
      aria-label={label}
    >
      <DeleteIcon />
    </button>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5h6v2m-7 0 1 12h6l1-12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LovhjemmelSection({
  lovhjemler,
  onAdd,
  onUpdate,
  onRemove,
}: {
  lovhjemler: Lovhjemmel[];
  onAdd: (lh: Lovhjemmel) => void;
  onUpdate: (idx: number, lh: Lovhjemmel) => void;
  onRemove: (idx: number) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState<Lovhjemmel>({
    lov: "",
    paragraf: undefined,
    url: undefined,
  });

  function openModal(index?: number) {
    if (index !== undefined) {
      setFormData(lovhjemler[index]);
      setEditingIndex(index);
    } else {
      setFormData({ lov: "", paragraf: undefined, url: undefined });
      setEditingIndex(null);
    }
    setModalOpen(true);
  }

  function handleSave() {
    if (!formData.lov.trim()) return;
    if (editingIndex !== null) {
      onUpdate(editingIndex, formData);
    } else {
      onAdd(formData);
    }
    setModalOpen(false);
  }

  return (
    <Section title="Lovhjemmel">
      <div className="space-y-3">
        {lovhjemler.map((lh, idx) => (
          <div
            key={idx}
            className="card p-4 border-l-4 border-purple-400 hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => openModal(idx)}
          >
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <h4 className="font-semibold text-gray-900">{lh.lov}</h4>
                {lh.paragraf && (
                  <p className="text-sm text-gray-600 mt-1">{lh.paragraf}</p>
                )}
                {lh.url && (
                  <a
                    href={lh.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-dark)] hover:underline mt-1 inline-block"
                  >
                    Åpne lovtekst
                  </a>
                )}
              </div>
              <DeleteActionButton
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(idx);
                }}
                label={`Slett lovhjemmel ${idx + 1}`}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => openModal()}
          className="btn-secondary w-full"
        >
          Legg til lovhjemmel
        </button>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingIndex !== null ? "Rediger lovhjemmel" : "Ny lovhjemmel"}
      >
        <div className="space-y-4">
          <FormField label="Lov *" required>
            <input
              type="text"
              value={formData.lov}
              onChange={(e) => setFormData({ ...formData, lov: e.target.value })}
              className="input-field"
              required
            />
          </FormField>
          <FormField label="Paragraf">
            <input
              type="text"
              value={formData.paragraf || ""}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  paragraf: e.target.value || undefined,
                })
              }
              placeholder="F.eks. § 2-1a"
              className="input-field"
            />
          </FormField>
          <FormField label="URL til lovtekst">
            <input
              type="url"
              value={formData.url || ""}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  url: e.target.value || undefined,
                })
              }
              placeholder="https://..."
              className="input-field"
            />
          </FormField>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleSave}
              className="btn-primary flex-1"
              disabled={!formData.lov.trim()}
            >
              Lagre
            </button>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="btn-secondary flex-1"
            >
              Avbryt
            </button>
          </div>
        </div>
      </Modal>
    </Section>
  );
}

function EksternLenkeSection({
  lenker,
  onAdd,
  onUpdate,
  onRemove,
}: {
  lenker: EksternLenke[];
  onAdd: (lenke: EksternLenke) => void;
  onUpdate: (idx: number, lenke: EksternLenke) => void;
  onRemove: (idx: number) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState<EksternLenke>({
    beskrivelse: "",
    url: "",
  });

  function openModal(index?: number) {
    if (index !== undefined) {
      setFormData(lenker[index]);
      setEditingIndex(index);
    } else {
      setFormData({ beskrivelse: "", url: "" });
      setEditingIndex(null);
    }
    setModalOpen(true);
  }

  function handleSave() {
    if (!formData.beskrivelse.trim() || !formData.url.trim()) return;
    if (editingIndex !== null) {
      onUpdate(editingIndex, formData);
    } else {
      onAdd(formData);
    }
    setModalOpen(false);
  }

  return (
    <Section title="Eksterne lenker">
      <div className="space-y-3">
        {lenker.map((lenke, idx) => (
          <div
            key={idx}
            className="card p-4 border-l-4 border-[var(--color-primary)] hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => openModal(idx)}
          >
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <h4 className="font-semibold text-gray-900">{lenke.beskrivelse}</h4>
                <a
                  href={lenke.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm text-[var(--color-primary)] hover:text-[var(--color-primary-dark)] hover:underline mt-1 block"
                >
                  {lenke.url}
                </a>
              </div>
              <DeleteActionButton
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(idx);
                }}
                label={`Slett lenke ${idx + 1}`}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => openModal()}
          className="btn-secondary w-full"
        >
          Legg til lenke
        </button>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingIndex !== null ? "Rediger lenke" : "Ny lenke"}
      >
        <div className="space-y-4">
          <FormField label="Beskrivelse *" required>
            <input
              type="text"
              value={formData.beskrivelse}
              onChange={(e) =>
                setFormData({ ...formData, beskrivelse: e.target.value })
              }
              className="input-field"
              required
            />
          </FormField>
          <FormField label="URL *" required>
            <input
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              placeholder="https://..."
              className="input-field"
              required
            />
          </FormField>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleSave}
              className="btn-primary flex-1"
              disabled={!formData.beskrivelse.trim() || !formData.url.trim()}
            >
              Lagre
            </button>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="btn-secondary flex-1"
            >
              Avbryt
            </button>
          </div>
        </div>
      </Modal>
    </Section>
  );
}

