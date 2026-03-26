import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

const providers = [];

// Only add Google provider if credentials are configured
if (
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_ID !== 'placeholder'
) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.provider = account.provider;
        token.providerId = account.providerAccountId;
        token.picture = (profile as any).picture ?? (profile as any).image;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        (session.user as any).provider = token.provider;
        (session.user as any).providerId = token.providerId;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/login',
  },
  session: {
    strategy: 'jwt',
  },
});
