export const minecraftName = /^[A-Za-z0-9_]{3,16}$/;

export interface MinecraftProfile {
  uuid: string;
  name: string;
}
