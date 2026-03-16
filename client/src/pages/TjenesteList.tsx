import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Tjeneste, TjenesteguideMetadata } from "../types/tjeneste";
import {
  fetchTjenester,
  deleteTjeneste,
  fetchTjenesteguideMetadata,
  updateTjenesteguideMetadata,
} from "../api/tjenester";
import RichTextEditor from "../components/RichTextEditor";
import {
  encodeUtf8ToBase64,
  normalizeBeskrivelseRepresentations,
  resolveRichHtml,
  stripRichTextToPlainText,
} from "../utils/richText";

const INITIAL_GUIDE_METADATA: TjenesteguideMetadata = {
  generell_beskrivelse: "",
  generell_beskrivelse_plain_text: "",
  generell_beskrivelse_rich_base64: "",
};

export default function TjenesteList() {
  const [tjenester, setTjenester] = useState<Tjeneste[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [tjenestetypeFilter, setTjenestetypeFilter] = useState<string>("");
  const [trinnFilter, setTrinnFilter] = useState<string>("");
  const [guideMetadata, setGuideMetadata] =
    useState<TjenesteguideMetadata>(INITIAL_GUIDE_METADATA);
  const [savedGuideMetadataSnapshot, setSavedGuideMetadataSnapshot] = useState(
    JSON.stringify(INITIAL_GUIDE_METADATA)
  );
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataSaved, setMetadataSaved] = useState(false);
  const latestRequestIdRef = useRef(0);
  const navigate = useNavigate();
  const guideDescriptionRichHtml = useMemo(
    () =>
      resolveRichHtml({
        beskrivelse: guideMetadata.generell_beskrivelse,
        beskrivelse_plain_text: guideMetadata.generell_beskrivelse_plain_text,
        beskrivelse_rich_base64: guideMetadata.generell_beskrivelse_rich_base64,
      }),
    [
      guideMetadata.generell_beskrivelse,
      guideMetadata.generell_beskrivelse_plain_text,
      guideMetadata.generell_beskrivelse_rich_base64,
    ]
  );

  useEffect(() => {
    void loadMetadata();
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadTjenester();
    }, 200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchQuery, statusFilter, tjenestetypeFilter, trinnFilter]);

  useEffect(() => {
    if (!metadataSaved) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setMetadataSaved(false);
    }, 2200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [metadataSaved]);

  async function loadMetadata() {
    try {
      setMetadataLoading(true);
      setMetadataError(null);
      const metadata = await fetchTjenesteguideMetadata();
      const normalized = normalizeBeskrivelseRepresentations({
        beskrivelse: metadata.generell_beskrivelse,
        beskrivelse_plain_text: metadata.generell_beskrivelse_plain_text,
        beskrivelse_rich_base64: metadata.generell_beskrivelse_rich_base64,
      });
      const nextMetadata: TjenesteguideMetadata = {
        generell_beskrivelse: normalized.beskrivelse,
        generell_beskrivelse_plain_text: normalized.beskrivelse_plain_text,
        generell_beskrivelse_rich_base64: normalized.beskrivelse_rich_base64,
      };
      setGuideMetadata(nextMetadata);
      setSavedGuideMetadataSnapshot(JSON.stringify(nextMetadata));
    } catch (err: any) {
      setMetadataError(err.message || "Kunne ikke laste generell beskrivelse");
    } finally {
      setMetadataLoading(false);
    }
  }

  async function loadTjenester() {
    const requestId = ++latestRequestIdRef.current;

    try {
      setLoading(true);
      setError(null);
      const data = await fetchTjenester({
        q: searchQuery || undefined,
        status: statusFilter || undefined,
        tjenestetype: tjenestetypeFilter || undefined,
        trinn_niva: trinnFilter || undefined,
      });

      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      setTjenester(data);
    } catch (err: any) {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }
      setError(err.message || "Kunne ikke laste tjenester");
    } finally {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }

  async function handleSaveGuideDescription() {
    try {
      setMetadataSaving(true);
      setMetadataError(null);
      const updated = await updateTjenesteguideMetadata(guideMetadata);
      const normalized = normalizeBeskrivelseRepresentations({
        beskrivelse: updated.generell_beskrivelse,
        beskrivelse_plain_text: updated.generell_beskrivelse_plain_text,
        beskrivelse_rich_base64: updated.generell_beskrivelse_rich_base64,
      });
      const nextMetadata: TjenesteguideMetadata = {
        generell_beskrivelse: normalized.beskrivelse,
        generell_beskrivelse_plain_text: normalized.beskrivelse_plain_text,
        generell_beskrivelse_rich_base64: normalized.beskrivelse_rich_base64,
      };
      setGuideMetadata(nextMetadata);
      setSavedGuideMetadataSnapshot(JSON.stringify(nextMetadata));
      setMetadataSaved(true);
    } catch (err: any) {
      setMetadataError(err.message || "Kunne ikke lagre generell beskrivelse");
    } finally {
      setMetadataSaving(false);
    }
  }

  async function handleDelete(id: string, navn: string) {
    if (!confirm(`Er du sikker på at du vil slette "${navn}"?`)) {
      return;
    }

    try {
      await deleteTjeneste(id);
      await loadTjenester();
    } catch (err: any) {
      alert(`Kunne ikke slette tjeneste: ${err.message}`);
    }
  }

  if (!hasLoadedOnce && loading) {
    return (
      <div className="flex flex-col justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--color-primary)] mb-4"></div>
        <div className="text-[var(--color-text-muted)] font-medium">Laster tjenester...</div>
      </div>
    );
  }

  const hasGuideDescriptionChanges =
    JSON.stringify(guideMetadata) !== savedGuideMetadataSnapshot;

  function handleGuideDescriptionChange(richHtml: string) {
    const plainText = stripRichTextToPlainText(richHtml);
    setGuideMetadata({
      generell_beskrivelse: plainText,
      generell_beskrivelse_plain_text: plainText,
      generell_beskrivelse_rich_base64: encodeUtf8ToBase64(richHtml),
    });
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold text-[var(--color-text)] mb-2">Tjenester</h1>
          <div className="badge badge-primary">
            {tjenester.length} {tjenester.length === 1 ? "tjeneste" : "tjenester"} funnet
          </div>
        </div>
        {loading && (
          <div className="badge badge-muted">
            Oppdaterer resultater...
          </div>
        )}
      </div>

      <div className="card p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-[var(--color-text)]">
              Generell beskrivelse av Tjenesteguide
            </h2>
            <p className="text-sm text-[var(--color-text-muted)] max-w-3xl">
              Denne teksten gjelder hele Tjenesteguide og lagres ett sted i JSON-fila. Den er
              ikke knyttet til enkeltjenester.
            </p>
          </div>
          {metadataSaved && (
            <div className="badge badge-primary">
              Lagret
            </div>
          )}
        </div>

        <div
          aria-disabled={metadataLoading || metadataSaving}
          className={metadataLoading || metadataSaving ? "pointer-events-none opacity-70" : ""}
        >
          <RichTextEditor
            value={guideDescriptionRichHtml}
            onChange={handleGuideDescriptionChange}
            placeholder="Skriv en generell beskrivelse av Tjenesteguide..."
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-[var(--color-text-muted)]">
            {metadataLoading
              ? "Laster beskrivelse..."
              : metadataError
              ? metadataError
              : "Bruk denne til å beskrive hva Tjenesteguide er på et overordnet nivå."}
          </div>
          <button
            type="button"
            onClick={() => void handleSaveGuideDescription()}
            className="btn-primary"
            disabled={metadataLoading || metadataSaving || !hasGuideDescriptionChanges}
          >
            {metadataSaving ? "Lagrer..." : "Lagre beskrivelse"}
          </button>
        </div>
      </div>

      {error && (
        <div className="card p-6 border-l-4 border-red-500 bg-red-50/80">
          <div>
            <h3 className="font-semibold text-red-900 mb-1">Feil ved lasting</h3>
            <p className="text-red-700">{error}</p>
          </div>
        </div>
      )}

      <div className="surface-muted p-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-[var(--color-text-muted)] mb-2">
            Søk
          </label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Søk i navn, synonymer, temaer, beskrivelse..."
            className="input-field"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <label className="block text-sm font-semibold text-[var(--color-text-muted)] mb-2">
              Status
            </label>
            <div
              role="radiogroup"
              aria-label="Filtrer status"
              className="flex flex-wrap gap-2"
            >
              {(
                [
                  { value: "", label: "Alle" },
                  { value: "aktiv", label: "Aktiv" },
                  { value: "planlagt", label: "Planlagt" },
                  { value: "utgår", label: "Utgår" },
                ] as const
              ).map((option) => {
                const isActive = statusFilter === option.value;
                return (
                  <button
                    key={option.label}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => setStatusFilter(option.value)}
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
          </div>

          <div>
            <label className="block text-sm font-semibold text-[var(--color-text-muted)] mb-2">
              Tjenestetype
            </label>
            <input
              type="text"
              value={tjenestetypeFilter}
              onChange={(e) => setTjenestetypeFilter(e.target.value)}
              placeholder="Filtrer på tjenestetype..."
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[var(--color-text-muted)] mb-2">
              Trinnnivå
            </label>
            <select
              value={trinnFilter}
              onChange={(e) => setTrinnFilter(e.target.value)}
              className="input-field"
            >
              <option value="">Alle</option>
              <option value="grunnmur">Grunnmur</option>
              <option value="trinn1">Trinn 1</option>
              <option value="trinn2">Trinn 2</option>
              <option value="trinn3">Trinn 3</option>
              <option value="trinn4">Trinn 4</option>
              <option value="trinn5">Trinn 5</option>
              <option value="trinn6">Trinn 6</option>
            </select>
          </div>
        </div>
      </div>

      {tjenester.length === 0 ? (
        <div className="card p-12 text-center">
          <h3 className="text-xl font-semibold text-[var(--color-text)] mb-2">
            Ingen tjenester funnet
          </h3>
          <p className="text-[var(--color-text-muted)] mb-6">
            {searchQuery || statusFilter || tjenestetypeFilter || trinnFilter
              ? "Prøv å justere søkekriteriene dine"
              : "Opprett din første tjeneste for å komme i gang"}
          </p>
          {!searchQuery && !statusFilter && !tjenestetypeFilter && !trinnFilter && (
            <Link
              to="/tjenester/ny"
              className="btn-primary"
            >
              Opprett første tjeneste
            </Link>
          )}
        </div>
      ) : (
        <div className="table-shell shadow-md">
          <div className="overflow-x-hidden">
            <table className="w-full table-fixed divide-y divide-[var(--color-border)]">
              <thead className="table-head">
                <tr>
                  <th className="w-[20%] px-4 py-4 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Navn
                  </th>
                  <th className="w-[9%] px-4 py-4 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Kort navn
                  </th>
                  <th className="w-[13%] px-4 py-4 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Tjenestetype
                  </th>
                  <th className="w-[9%] px-4 py-4 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Vedtaksbasert
                  </th>
                  <th className="w-[8%] px-4 py-4 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Lavterskel
                  </th>
                  <th className="w-[9%] px-4 py-4 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Status
                  </th>
                  <th className="w-[9%] px-4 py-4 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Trinn
                  </th>
                  <th className="w-[15%] px-4 py-4 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Temaer
                  </th>
                  <th className="w-[8%] px-4 py-4 text-right text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Handlinger
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-[var(--color-border)]">
                {tjenester.map((tjeneste) => (
                  <tr 
                    key={tjeneste.id} 
                    className="table-row cursor-pointer odd:bg-white even:bg-[#fbfdff]"
                    onClick={() => navigate(`/tjenester/${tjeneste.id}`)}
                  >
                    <td className="px-4 py-4 align-top">
                      <div className="text-sm font-semibold text-[var(--color-text)] max-w-[13rem] break-words leading-5">
                        {tjeneste.navn}
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <div className="text-sm text-[var(--color-text-muted)] break-words">
                        {tjeneste.kort_navn || (
                          <span className="text-gray-400 italic">-</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <span className="badge badge-primary break-words max-w-full">
                        {tjeneste.tjenestetype}
                      </span>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        tjeneste.vedtaksbasert
                          ? "bg-[rgba(99,91,255,0.14)] text-[var(--color-primary)]"
                          : "bg-[rgba(48,209,88,0.14)] text-emerald-800"
                      }`}>
                        {tjeneste.vedtaksbasert ? "Ja" : "Nei"}
                      </span>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        tjeneste.lavterskel
                          ? "bg-[rgba(48,209,88,0.14)] text-emerald-800"
                          : "bg-[#edf2f7] text-[var(--color-text-muted)]"
                      }`}>
                        {tjeneste.lavterskel ? "Ja" : "Nei"}
                      </span>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <span
                        className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                          tjeneste.status === "aktiv"
                            ? "bg-green-100 text-green-800 shadow-sm"
                            : tjeneste.status === "planlagt"
                            ? "bg-yellow-100 text-yellow-800 shadow-sm"
                            : "bg-red-100 text-red-800 shadow-sm"
                        }`}
                      >
                        {tjeneste.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-[rgba(99,91,255,0.14)] text-[var(--color-primary)]">
                        {tjeneste.trinn_nivå === "grunnmur"
                          ? "Grunnmur"
                          : tjeneste.trinn_nivå.replace("trinn", "Trinn ")}
                      </span>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex flex-wrap gap-1">
                        {tjeneste.temaer.slice(0, 2).map((tema, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#edf2f7] text-[var(--color-text-muted)] break-words"
                          >
                            {tema}
                          </span>
                        ))}
                        {tjeneste.temaer.length > 2 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                            +{tjeneste.temaer.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td 
                      className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium align-top"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => navigate(`/tjenester/${tjeneste.id}`)}
                          className="icon-btn"
                          title="Rediger tjeneste"
                          aria-label={`Rediger ${tjeneste.navn}`}
                        >
                          <EditIcon />
                        </button>
                        <button
                          onClick={() => handleDelete(tjeneste.id, tjeneste.navn)}
                          className="icon-btn icon-btn-danger"
                          title="Slett tjeneste"
                          aria-label={`Slett ${tjeneste.navn}`}
                        >
                          <DeleteIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 20h4l10-10-4-4L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m12 6 4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

