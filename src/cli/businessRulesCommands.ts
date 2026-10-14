import { z } from "incur";
import { resolve } from "node:path";
import type { Logger } from "pino";
import {
  createBusinessRulesArtifactService,
  createBusinessRulesProgramService,
} from "../composition/businessRules.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { withCommandCancellation } from "./commandCancellation.js";
import type { CliInstance } from "./types.js";

type FileInspection = Pick<
  ReturnType<typeof createBusinessRulesProgramService>,
  "inspect"
>;

/** Register one path-argument command over a shared Business Rules! file workflow. */
const registerFileCommand = (
  cli: CliInstance,
  logger: Logger,
  command: { name: string; description: string; argument: string },
  service: FileInspection,
): void => {
  cli.command(command.name, {
    description: command.description,
    args: z.object({ path: z.string().describe(command.argument) }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, command.name, async () => {
          const result = await service.inspect(
            { path: resolve(args.path) },
            { signal },
          );
          return result.ok ? result.value : projectAnalysisError(result.error);
        }),
      ),
  });
};

/** Resolve operator paths and run the shared Business Rules! workflows. */
export const registerBusinessRulesCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  registerFileCommand(
    cli,
    logger,
    {
      name: CLI_COMMANDS.inspectBusinessRulesProgram,
      description:
        "Decode header, listing and symbols from a compiled Business Rules! program",
      argument: "Local compiled program (.br/.wb)",
    },
    createBusinessRulesProgramService(),
  );
  registerFileCommand(
    cli,
    logger,
    {
      name: CLI_COMMANDS.inspectBusinessRulesArtifact,
      description:
        "Read a Business Rules! runtime status file or index plain-text source references",
      argument: "Local status file (ST-FILE.*) or source (.brs/.wbs/.prc)",
    },
    createBusinessRulesArtifactService(),
  );
};
