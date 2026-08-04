import NextAuth from 'next-auth';
const { authOptions } = require('../../../lib/auth');

export default NextAuth(authOptions);
