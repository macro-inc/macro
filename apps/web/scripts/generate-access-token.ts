import { config } from "dotenv";

// Load environment variables from .env file
config();

const FUSIONAUTH_DOMAIN = process.env.FUSIONAUTH_DOMAIN ?? "https://fusionauth-dev.macro.com";

async function generateAccessToken(): Promise<string> {
  const refreshToken = process.env.REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error("REFRESH_TOKEN environment variable is not set");
  }

  const response = await fetch(`${FUSIONAUTH_DOMAIN}/api/jwt/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: "garbage", // we only need to pass in a valid refresh token to FA
      refreshToken: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to generate access token: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  const data = await response.json();

  if (!data.token) {
    throw new Error("Response did not contain a token");
  }

  return data.token;
}

const token = await generateAccessToken();
console.log("Access Token:");
console.log(token);
