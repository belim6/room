import type { PersonaName } from "./personas/personas";
import { PERSONA_WEBHOOKS } from "./personaWebhooks";
import { limitReply } from "./replyLimit";

export async function sendViaWebhook(persona: PersonaName, content: string) {
  const webhookUrl = PERSONA_WEBHOOKS[persona];

  if (!webhookUrl) {
    console.error(`❌ No webhook URL configured for persona: ${persona}`);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: limitReply(content) }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Webhook failed for ${persona} (${res.status}): ${text.slice(0, 1200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
