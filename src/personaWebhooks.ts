import type { PersonaName } from "./personas/personas";

export const PERSONA_WEBHOOKS: Record<PersonaName, string> = {
  Alexandra: process.env.WEBHOOK_ALEXANDRA!,
  Elorin: process.env.WEBHOOK_ELORIN!,
  Jonas: process.env.WEBHOOK_JONAS!,
  Ceryn: process.env.WEBHOOK_CERYN!,
  Velric: process.env.WEBHOOK_VELRIC!,
  Rook: process.env.WEBHOOK_ROOK!,
  Ilya: process.env.WEBHOOK_ILYA!,
  Boris: process.env.WEBHOOK_BORIS!,
};

