import express, { Request, Response } from "express";
import {
  getAllTjenester,
  getTjenesteById,
  createTjenesteWithAutoId,
  updateTjeneste,
  deleteTjeneste,
} from "../repository/tjenesterRepo";
import { TjenesteSchema } from "../validation/tjenesteSchema";
import { Tjeneste } from "../models/tjeneste";

const router = express.Router();
const CreateTjenesteSchema = TjenesteSchema.omit({ id: true });

/**
 * Search and filter tjenester in-memory.
 */
function filterTjenester(
  tjenester: Tjeneste[],
  query?: string,
  status?: string,
  tema?: string,
  tjenestetype?: string,
  trinnNiva?: string
): Tjeneste[] {
  let filtered = [...tjenester];

  // Free-text search
  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter((t) => {
      const searchableText = [
        t.navn,
        t.kort_navn,
        ...(t.synonymer || []),
        ...(t.temaer || []),
        ...(t.målgruppe || []).flatMap((målgruppe) => [
          målgruppe.beskrivelse,
          ...(målgruppe.kategorier || []),
        ]),
        t.beskrivelse,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchableText.includes(q);
    });
  }

  // Status filter
  if (status) {
    filtered = filtered.filter((t) => t.status === status);
  }

  // Tema filter
  if (tema) {
    filtered = filtered.filter((t) => t.temaer.includes(tema));
  }

  // Tjenestetype filter
  if (tjenestetype) {
    filtered = filtered.filter((t) => t.tjenestetype === tjenestetype);
  }

  // Trinnnivå filter
  if (trinnNiva) {
    filtered = filtered.filter((t) => t.trinn_nivå === trinnNiva);
  }

  return filtered;
}

/**
 * GET /api/tjenester
 * List all tjenester with optional search/filter.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { q, status, tema, tjenestetype, trinn_niva } = req.query;
    let tjenester = await getAllTjenester();

    tjenester = filterTjenester(
      tjenester,
      q as string | undefined,
      status as string | undefined,
      tema as string | undefined,
      tjenestetype as string | undefined,
      trinn_niva as string | undefined
    );

    res.json(tjenester);
  } catch (error) {
    console.error("Error fetching tjenester:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/tjenester/:id
 * Get a single tjeneste by ID.
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const tjeneste = await getTjenesteById(id);

    if (!tjeneste) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json(tjeneste);
  } catch (error) {
    console.error("Error fetching tjeneste:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/tjenester
 * Create a new tjeneste.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    // Validate request body and ignore any provided ID.
    const validationResult = CreateTjenesteSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: "Validation error",
        details: validationResult.error.errors,
      });
    }

    const created = await createTjenesteWithAutoId(validationResult.data);
    res.status(201).json(created);
  } catch (error: any) {
    console.error("Error creating tjeneste:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /api/tjenester/:id
 * Update an existing tjeneste (full replacement).
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate request body
    const validationResult = TjenesteSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: "Validation error",
        details: validationResult.error.errors,
      });
    }

    const tjeneste = validationResult.data;
    
    // Ensure ID matches URL parameter
    tjeneste.id = id;

    const updated = await updateTjeneste(id, tjeneste);
    res.json(updated);
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return res.status(404).json({ error: "Not found" });
    }
    console.error("Error updating tjeneste:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/tjenester/:id
 * Partially update an existing tjeneste.
 */
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await getTjenesteById(id);

    if (!existing) {
      return res.status(404).json({ error: "Not found" });
    }

    // Merge with existing
    const merged = { ...existing, ...req.body, id };

    // Validate merged result
    const validationResult = TjenesteSchema.safeParse(merged);
    if (!validationResult.success) {
      return res.status(400).json({
        error: "Validation error",
        details: validationResult.error.errors,
      });
    }

    const updated = await updateTjeneste(id, validationResult.data);
    res.json(updated);
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return res.status(404).json({ error: "Not found" });
    }
    console.error("Error updating tjeneste:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/tjenester/:id
 * Delete a tjeneste.
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteTjeneste(id);
    res.status(204).send();
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return res.status(404).json({ error: "Not found" });
    }
    console.error("Error deleting tjeneste:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

