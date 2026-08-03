# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## Supabase foundation

The application remains LocalStorage-backed while the Supabase migration is in progress. Supabase configuration is optional until cloud reads are enabled.

To prepare a local environment, copy `.env.example` to `.env` and provide only:

```text
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Both browser-safe values are available from the Supabase project Connect dialog. Never place a database password or service-role key in a `PUBLIC_*` variable or commit it to the repository.

Database changes live in `supabase/migrations/`. Apply them through the connected Supabase GitHub deployment or the Supabase CLI; do not recreate the schema manually in the dashboard.

Parent authentication uses Supabase email and password accounts. In Supabase, keep the Email provider enabled and add both the local parent page and deployed parent page to **Authentication → URL Configuration → Redirect URLs**:

```text
http://localhost:4321/parent/
https://samwolcott.github.io/kid-budget/parent/
```

Signing in creates or restores the parent's family account, but budgeting data remains in LocalStorage until a later migration sprint.

After signing in, the home page asks the parent to create separate four-digit PINs for Parent, Judah, and Max. PIN verifiers are stored in Supabase; only a temporary profile unlock is stored in browser session storage. A kid device can optionally remember Judah or Max and open directly to that child's PIN screen.
