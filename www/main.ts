import { UserManager } from "oidc-client-ts";

const cognitoAuthConfig = {
  authority:
    "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_mxuhAF0tx",
  client_id: "6r4394rjse5b1pk3hapj4fr7lj",
  redirect_uri: "https://tenjaa.github.io/callback.html",
  response_type: "code",
  scope: "email openid phone",
};

// create a UserManager instance
export const userManager = new UserManager({
  ...cognitoAuthConfig,
});

export async function signOutRedirect() {
  const clientId = "6r4394rjse5b1pk3hapj4fr7lj";
  const logoutUri = "<logout uri>";
  const cognitoDomain =
    "https://eu-central-1mxuhaf0tx.auth.eu-central-1.amazoncognito.com";
  window.location.href = `${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(logoutUri)}`;
}
