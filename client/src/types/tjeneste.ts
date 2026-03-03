// Shared types - should match server/src/models/tjeneste.ts
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

export type LeverandørType = "kommunal" | "frivillig" | "statlig" | "privat";

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
  beskrivelse: string;
  beskrivelse_plain_text?: string;
  beskrivelse_rich_base64?: string;
  tildelingskriterier?: string[];
  særlige_varianter?: SærligVariant[];
  vedtak?: VedtakInfo;
  hva_kan_du_forvente?: string[];
  forventninger_til_bruker?: string[];
  evaluering?: Evaluering;
  pris?: PrisInfo;
  lovhjemmel?: Lovhjemmel[];
  kontaktpunkter?: Kontaktpunkt[];
  eksterne_lenker?: EksternLenke[];
  status: TjenesteStatus;
  trinn_nivå: TrinnNiva;
  interne_notater?: string[];
}

export interface Lovhjemmel {
  lov: string;
  paragraf?: string;
  url?: string;
}

