import { z } from "zod";

const MinecraftApiResponse = z.object({
  id: z.string(),
  name: z.string(),
});
type MinecraftApiResponse = z.infer<typeof MinecraftApiResponse>;

export async function resolveMinecraftProfile(
  username: string,
): Promise<MinecraftApiResponse | undefined> {
  const response = await fetch(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
    { signal: AbortSignal.timeout(5000), redirect: "error" },
  );
  if (response.status === 404) {
    console.log(`Minecraft profile lookup failed: ${username} not found`);
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Minecraft profile lookup failed: ${response.status}`);
  }
  return MinecraftApiResponse.parse(await response.json());
}
