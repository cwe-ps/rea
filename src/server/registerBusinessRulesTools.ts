import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type {
  BusinessRulesArtifactService,
  BusinessRulesProgramService,
} from "../composition/businessRules.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { logToolExecution } from "./toolLogging.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind each named Business Rules! contract to its shared validation and Evidence recording. */
export const registerBusinessRulesTools = (
  server: EvidenceMcpServer,
  services: {
    readonly program: BusinessRulesProgramService;
    readonly artifact: BusinessRulesArtifactService;
  },
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
): void => {
  const bindings = [
    {
      contract: toolContract("inspect_business_rules_program"),
      service: services.program,
    },
    {
      contract: toolContract("inspect_business_rules_artifact"),
      service: services.artifact,
    },
  ];
  for (const { contract, service } of bindings)
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      async (input, context) => {
        const result = await logToolExecution(logger, contract.name, () =>
          service.inspect(input, { signal: context.mcpReq.signal }),
        );
        if (!result.ok)
          return server.delivery.toCallToolResult(result, contract);
        const recorded = recordEvidence?.(result.value);
        return server.delivery.toEvidenceToolResult(
          result.value,
          contract,
          recorded,
        );
      },
    );
};
