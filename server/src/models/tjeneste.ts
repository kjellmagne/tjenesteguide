export interface Målgruppe {
  kategorier?: string[];
  alder_fra?: number | null;
  alder_til?: number | null;
  beskrivelse: string;
}

export interface Geografi {
  kommune: string;
  områder: string[];
}

export interface SærligVariant {
  navn: string;
  ekstra_kriterier: string[];
}

export interface VedtakInfo {
  krever_søknad: boolean;
  søknadsvei: string;
  søknad_url?: string;
  korte_punkter?: string[];
}

export interface Evaluering {
  frekvens?: string;
  spørsmål?: string[];
}

export interface PrisInfo {
  betalingstype: "egenandel" | "gratis" | "full_pris" | "annet";
  beskrivelse: string;
  beløp?: number;
  prislenke?: string;
}

export interface Lovhjemmel {
  lov: string;
  paragraf?: string;
  url?: string;
}

export type KontaktpunktType =
  | "telefon"
  | "epost"
  | "nettside"
  | "kontor"
  | "annet";

export interface Kontaktpunkt {
  type: KontaktpunktType;
  beskrivelse: string;
  verdi: string;
  åpningstid?: string;
}

export interface EksternLenke {
  beskrivelse: string;
  url: string;
}

export type LeverandørType =
  | "kommunal"
  | "frivillig"
  | "statlig"
  | "privat"
  | "samarbeid";

export type TjenesteStatus = "aktiv" | "planlagt" | "utgår";
export type TrinnNiva =
  | "grunnmur"
  | "trinn1"
  | "trinn2"
  | "trinn3"
  | "trinn4"
  | "trinn5"
  | "trinn6";

export interface Tjeneste {
  id: string;
  navn: string;
  kort_navn?: string;
  synonymer?: string[];
  kategori_sti: string[];
  temaer: string[];
  tjenestetype: string;
  vedtaksbasert: boolean;
  lavterskel: boolean;
  målgruppe: Målgruppe[];
  leverandør_type?: LeverandørType;
  leverandør_organisasjoner?: string[];
  geografi?: Geografi;
  for_du_søker?: string[];
  for_du_søker_plain_text?: string;
  for_du_søker_rich_base64?: string;
  beskrivelse: string;
  beskrivelse_plain_text?: string;
  beskrivelse_rich_base64?: string;
  tildelingskriterier?: string[];
  tildelingskriterier_plain_text?: string;
  tildelingskriterier_rich_base64?: string;
  dette_inngår_ikke_i_tjenestetilbudet?: string[];
  dette_inngår_ikke_i_tjenestetilbudet_plain_text?: string;
  dette_inngår_ikke_i_tjenestetilbudet_rich_base64?: string;
  særlige_varianter?: SærligVariant[];
  vedtak?: VedtakInfo;
  hva_kan_du_forvente?: string[];
  hva_kan_du_forvente_plain_text?: string;
  hva_kan_du_forvente_rich_base64?: string;
  forventninger_til_bruker?: string[];
  forventninger_til_bruker_plain_text?: string;
  forventninger_til_bruker_rich_base64?: string;
  evaluering?: Evaluering;
  pris?: PrisInfo;
  lovhjemmel?: Lovhjemmel[];
  kontaktpunkter?: Kontaktpunkt[];
  eksterne_lenker?: EksternLenke[];
  status: TjenesteStatus;
  trinn_nivå: TrinnNiva;
  interne_notater?: string[];
}

export interface TjenesteguideMetadata {
  generell_beskrivelse: string;
  generell_beskrivelse_plain_text?: string;
  generell_beskrivelse_rich_base64?: string;
}

