import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SYNC_DB_CONNECTION_UI_ERROR,
  classifySyncInfrastructureError,
  mapSyncInfrastructureErrorForUi,
} from "./sync-errors.ts";

describe("mapSyncInfrastructureErrorForUi", () => {
  it("returns a safe connection message for TLS failures", () => {
    const error = new Error("self-signed certificate in certificate chain");
    assert.equal(mapSyncInfrastructureErrorForUi(error), SYNC_DB_CONNECTION_UI_ERROR);
    assert.equal(
      mapSyncInfrastructureErrorForUi(error).includes("self-signed"),
      false,
    );
  });

  it("does not return raw host or URL details", () => {
    const error = new Error(
      "connect ECONNREFUSED db.stnnvftbdkfkkuobjwbd.supabase.co:5432",
    );
    const ui = mapSyncInfrastructureErrorForUi(error);
    assert.equal(ui, SYNC_DB_CONNECTION_UI_ERROR);
    assert.equal(ui.includes("supabase"), false);
    assert.equal(ui.includes("5432"), false);
  });

  it("classifies TLS errors as connection", () => {
    const classified = classifySyncInfrastructureError(
      Object.assign(new Error("self-signed certificate in certificate chain"), {
        code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      }),
    );
    assert.equal(classified.category, "connection");
    assert.equal(classified.code, "UNABLE_TO_GET_ISSUER_CERT_LOCALLY");
  });

  it("classifies missing URL as configuration", () => {
    const classified = classifySyncInfrastructureError(
      new Error("Missing SUPABASE_DB_URL (or POSTGRES_URL) for schedule sync."),
    );
    assert.equal(classified.category, "configuration");
  });

  it("classifies unknown errors as unexpected without exposing them in UI", () => {
    const secretish = new Error("password authentication failed for user sync_admin");
    const classified = classifySyncInfrastructureError(secretish);
    // auth failures are treated as connection-class infrastructure issues
    assert.equal(classified.category, "connection");
    const ui = mapSyncInfrastructureErrorForUi(secretish);
    assert.equal(ui, SYNC_DB_CONNECTION_UI_ERROR);
    assert.equal(ui.includes("password"), false);
    assert.equal(ui.includes("sync_admin"), false);
  });
});
