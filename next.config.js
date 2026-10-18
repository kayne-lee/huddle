/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // A lockfile in a parent directory otherwise makes Next pick the wrong workspace root.
  turbopack: { root: import.meta.dirname },
};

export default config;
