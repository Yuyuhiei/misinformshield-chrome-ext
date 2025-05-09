// build.js for commonJS ver
const dotenv = require('dotenv');
const { build } = require('esbuild');

dotenv.config();

build({
  entryPoints: ['background/background.js'],
  outfile: 'dist/background.js',
  bundle: true,
  platform: 'browser',
  define: {
    'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL),
    'process.env.SUPABASE_KEY': JSON.stringify(process.env.SUPABASE_KEY),
  },
}).catch(() => process.exit(1));