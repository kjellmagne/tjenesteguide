import { z } from "zod";

const MålgruppeSchema = z.object({
  kategorier: z.array(z.string()).optional(),
  alder_fra: z.number().nullable().optional(),
  alder_til: z.number().nullable().optional(),
  beskrivelse: z.string(),
});

const GeografiSchema = z.object({
  kommune: z.string(),
  områder: z.array(z.string()),
});

const SærligVariantSchema = z.object({
  navn: z.string(),
  ekstra_kriterier: z.array(z.string()),
});

const VedtakInfoSchema = z.object({
  krever_søknad: z.boolean(),
  søknadsvei: z.string(),
  søknad_url: z.string().optional(),
  korte_punkter: z.array(z.string()).optional(),
});

const EvalueringSchema = z.object({
  frekvens: z.string().optional(),
  spørsmål: z.array(z.string()).optional(),
});

const PrisInfoSchema = z.object({
  betalingstype: z.enum(["egenandel", "gratis", "full_pris", "annet"]),
  beskrivelse: z.string(),
  beløp: z.number().nonnegative().optional(),
  prislenke: z.string().optional(),
});

const LovhjemmelSchema = z.object({
  lov: z.string(),
  paragraf: z.string().optional(),
  url: z.string().optional(),
});

const KontaktpunktTypeSchema = z.enum([
  "telefon",
  "epost",
  "nettside",
  "kontor",
  "annet",
]);

const KontaktpunktSchema = z.object({
  type: KontaktpunktTypeSchema,
  beskrivelse: z.string(),
  verdi: z.string(),
});

const EksternLenkeSchema = z.object({
  beskrivelse: z.string(),
  url: z.string(),
});

const LeverandørTypeSchema = z.enum([
  "kommunal",
  "frivillig",
  "statlig",
  "privat",
]);

const TjenesteStatusSchema = z.enum(["aktiv", "planlagt", "utgår"]);
const TrinnNivaSchema = z.enum([
  "grunnmur",
  "trinn1",
  "trinn2",
  "trinn3",
  "trinn4",
  "trinn5",
  "trinn6",
]);

export const TjenesteSchema = z.object({
  id: z.string(),
  navn: z.string(),
  kort_navn: z.string().optional(),
  synonymer: z.array(z.string()).optional(),
  kategori_sti: z.array(z.string()),
  temaer: z.array(z.string()),
  tjenestetype: z.string(),
  vedtaksbasert: z.boolean(),
  lavterskel: z.boolean(),
  målgruppe: z.array(MålgruppeSchema),
  leverandør_type: LeverandørTypeSchema.optional(),
  leverandør_organisasjoner: z.array(z.string()).optional(),
  geografi: GeografiSchema.optional(),
  for_du_søker: z.array(z.string()).optional(),
  beskrivelse: z.string(),
  tildelingskriterier: z.array(z.string()).optional(),
  særlige_varianter: z.array(SærligVariantSchema).optional(),
  vedtak: VedtakInfoSchema.optional(),
  hva_kan_du_forvente: z.array(z.string()).optional(),
  forventninger_til_bruker: z.array(z.string()).optional(),
  evaluering: EvalueringSchema.optional(),
  pris: PrisInfoSchema.optional(),
  lovhjemmel: z.array(LovhjemmelSchema).optional(),
  kontaktpunkter: z.array(KontaktpunktSchema).optional(),
  eksterne_lenker: z.array(EksternLenkeSchema).optional(),
  status: TjenesteStatusSchema,
  trinn_nivå: TrinnNivaSchema,
  interne_notater: z.array(z.string()).optional(),
});

export type TjenesteInput = z.infer<typeof TjenesteSchema>;

