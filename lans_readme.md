## WIP in progress

### how to run:

must have node.js

run 'npm install' in terminal to install necessary supabase  imports (supabase, esbuild)

create a '.env' file and place this:
```
SUPABASE_URL=<url_placeholder>
SUPABASE_KEY=<key_placeholder>
```

run 'node build.js' in terminal to create a dist version of background.js then add extension in chrome
 - go to chrome://extensions 
 - enable developer mode
 - click load unpacked
 - select extension folder of misinformshield

test!!

run 'node build.js' every new changes in background.js to implement changes
then reload the extension in chrome://extensions