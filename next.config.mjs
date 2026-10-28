// O painel mora numa subpasta do domínio (ex.: api.smul.pmsp/painel).
// Mude PAINEL_BASE_PATH no .env e rode "npm run build" de novo para trocar o caminho.
const basePath = process.env.PAINEL_BASE_PATH ?? "/painel";

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
