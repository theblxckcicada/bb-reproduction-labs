"use strict";

/**
 * Progress API — local, single-user learning progress.
 */

const express = require("express");

const { httpError } = require("../httpError");
const registry = require("../labs/registry");
const progress = require("../store/progressStore");

const router = express.Router();

router.get("/progress", (req, res) => {
  res.json(progress.getAll());
});

router.put("/progress/:id", (req, res, next) => {
  try {
    if (!registry.getById(req.params.id)) {
      throw httpError(404, `Unknown lab: ${req.params.id}`);
    }

    const { state, revealedHints } = req.body || {};
    const patch = {};
    if (state !== undefined) {
      patch.state = state;
    }
    if (revealedHints !== undefined) {
      patch.revealedHints = revealedHints;
    }
    if (Object.keys(patch).length === 0) {
      throw httpError(400, "Provide at least one of: state, revealedHints.");
    }

    const updated = progress.update(req.params.id, patch);
    res.json(updated);
  } catch (error) {
    // Validation errors from the store are client errors.
    if (!error.status) {
      error.status = 400;
      error.expose = true;
    }
    next(error);
  }
});

module.exports = router;
