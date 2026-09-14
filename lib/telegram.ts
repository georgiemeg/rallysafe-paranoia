const TEST_CHAT = "7615563736";

export async function sendOwnerTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const chats = Array.from(
    new Set([process.env.TELEGRAM_OWNER_CHAT_ID, TEST_CHAT].filter(Boolean) as string[])
  );
  await Promise.all(
    chats.map((chat_id) =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text }),
      }).catch(() => null)
    )
  );
  return chats.length > 0;
}
