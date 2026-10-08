import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://expeditiongrowthlab.com',
  output: 'server',
  adapter: cloudflare()
});
