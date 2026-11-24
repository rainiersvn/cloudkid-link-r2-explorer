# Security

## Basic Auth

Basic Auth was added in the `v1.0.2`, with support for multiple users.

To enable this feature, update your `src/index.ts` file with the desired usernames and passwords.

```ts
import { R2Explorer } from 'r2-explorer';

export default R2Explorer({ readonly: false, basicAuth: [{
    username: 'teste',
    password: 'abc'
  },{
    username: 'anotherUser',
    password: '123567'
  }]
});
```

After this, just deploy your application normally with:

```bash
wrangler deploy
```

---

You can also define just a single user like this:

```ts
import { R2Explorer } from 'r2-explorer';

export default R2Explorer({ readonly: false, basicAuth: {
    username: 'anotherUser',
    password: '123567'
  }
});
```


## Google sign-in

The production deployment enables `googleOAuth: true`. Custom installations must also use `assets.run_worker_first = true` so dashboard navigations reach the Worker.

1. Register an OAuth web client in Google Cloud with the exact callback `https://explorer.cloudkid.link/auth/google/callback` (substitute your own origin for other deployments).
2. Use `wrangler secret put` on the Explorer Worker for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` (at least 32 random bytes, encoded as hex or base64), and `GOOGLE_ALLOWED_EMAILS` (comma-separated exact addresses). Copy the approved roster from the existing Explorer policy.
3. Deploy behind the existing edge policy. Verify Google sign-in, sign-out, denial for an unlisted account, and anonymous API rejection. Then retire the Explorer Access application and its policy in Cloudflare Zero Trust and reconcile its companion Terraform declarations.

Sessions expire after 24 hours. Removing an address takes effect on the next authenticated request after the secret update. Rotating the session secret invalidates all sessions. Public shares and the health endpoint remain available without a session.
