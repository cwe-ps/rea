import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { readStableArtifact } from "../artifacts/readStableArtifact.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok, type Result } from "../domain/result.js";
import { BUSINESS_RULES_PROGRAM_LIMITS } from "./BusinessRulesRelease.js";

const readFailure = (
  providerId: string,
  operation: string,
  cause: unknown,
  path: string,
): AnalysisError => {
  if (cause instanceof AnalysisError) return cause;
  if (cause instanceof ArtifactReaderFailure) {
    if (cause.reason === "cancelled")
      return new AnalysisCancelledError(operation);
    if (cause.reason === "integrity")
      return new AnalysisArtifactChangedError(operation, path, cause.message, {
        cause,
      });
    if (["limit", "path", "format"].includes(cause.reason))
      return new AnalysisInputError(operation, { cause }, [
        {
          path: ["path"],
          reason: cause.reason === "limit" ? "out_of_range" : "invalid_format",
          message: cause.message,
        },
      ]);
  }
  if (cause instanceof Error && "code" in cause) {
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(operation, path, cause.code, {
        cause,
      });
    if (cause.code === "ENOENT" || cause.code === "ENOTDIR")
      return new AnalysisInputError(operation, { cause }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `Selected file could not be read (${String(cause.code)}): ${path}.`,
        },
      ]);
  }
  return new ProviderAdapterError(providerId, operation, {
    cause,
    diagnostics: {
      phase: "artifact-read",
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
};

/** Read one caller-selected file as a stable snapshot, mapping failures to their analysis reason. */
export const readBusinessRulesFile = async (
  providerId: string,
  operation: string,
  path: string,
  options?: ExecutionOptions,
): Promise<
  Result<{ readonly bytes: Buffer; readonly sha256: string }, AnalysisError>
> => {
  try {
    return ok(
      await readStableArtifact(
        path,
        BUSINESS_RULES_PROGRAM_LIMITS.inputBytes,
        options?.signal,
      ),
    );
  } catch (cause: unknown) {
    return err(
      options?.signal?.aborted
        ? new AnalysisCancelledError(operation)
        : readFailure(providerId, operation, cause, path),
    );
  }
};

const TEXT_PREFIX_BYTES = 4096;

/**
 * True when the leading bytes are Latin-1 text: printable bytes plus tab,
 * line feed, form feed, carriage return and the DOS end-of-file marker.
 */
export const isBusinessRulesText = (data: Uint8Array): boolean =>
  data.length > 0 &&
  data
    .subarray(0, TEXT_PREFIX_BYTES)
    .every(
      (byte) =>
        byte >= 0x20 ||
        byte === 0x09 ||
        byte === 0x0a ||
        byte === 0x0c ||
        byte === 0x0d ||
        byte === 0x1a,
    );
