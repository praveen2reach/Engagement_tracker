// lib/auth.js
//
// PHASE 1: email + password login (Credentials provider) so the team can use
// the tool immediately.
//
// PHASE 2 (once IT approves an app registration): add your SSO provider
// below and remove/hide the Credentials provider. Because NextAuth
// abstracts providers behind the same session/callback interface, none of
// the rest of the app (pages, API routes, role checks) needs to change.
//
// Example for Microsoft Entra ID (Azure AD), once you have the values from IT:
//
//   import AzureADProvider from 'next-auth/providers/azure-ad';
//   providers: [
//     AzureADProvider({
//       clientId: process.env.AZURE_AD_CLIENT_ID,
//       clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
//       tenantId: process.env.AZURE_AD_TENANT_ID,
//     }),
//   ]
//
// Example for Okta:
//   import OktaProvider from 'next-auth/providers/okta';
//   providers: [
//     OktaProvider({
//       clientId: process.env.OKTA_CLIENT_ID,
//       clientSecret: process.env.OKTA_CLIENT_SECRET,
//       issuer: process.env.OKTA_ISSUER,
//     }),
//   ]
//
// In both cases you'd also add a small `signIn` callback that looks up (or
// creates) the matching row in `users` by email, so `role` still comes from
// your own database rather than the identity provider.

const CredentialsProvider = require('next-auth/providers/credentials').default;
const bcrypt = require('bcryptjs');
const { sql } = require('./db');

const authOptions = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const { rows } = await sql`SELECT * FROM users WHERE email = ${credentials.email}`;
        const user = rows[0];
        if (!user) return null;
        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.uid = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.role = token.role;
      session.user.id = token.uid;
      return session;
    },
  },
};

module.exports = { authOptions };
