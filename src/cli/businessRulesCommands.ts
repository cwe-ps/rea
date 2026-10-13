import { z } from "incur";
import { resolve } from "node:path";
import type { Logger } from "pino";
import { createBusinessRulesProgramService } from "../composition/businessRules.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { withCommandCancellation } from "./commandCancellation.js";
import type { CliInstance } from "./types.js";

/** Resolve the operator path and run the shared compiled-program workflow. */
export const registerBusinessRulesCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  const service = createBusinessRulesProgramService();
  cli.command(CLI_COMMANDS.inspectBusinessRulesProgram, {
    description:
      "Decode header, listing and symbols from a compiled Business Rules! program",
    args: z.object({
      path: z.string().describe("Local compiled program (.br/.wb)"),
    }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(
          logger,
          CLI_COMMANDS.inspectBusinessRulesProgram,
          async () => {
            const result = await service.inspect(
              { path: resolve(args.path) },
              { signal },
            );
            return result.ok
              ? result.value
              : projectAnalysisError(result.error);
          },
        ),
      ),
  });
};
