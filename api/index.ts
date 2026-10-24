// Vercel Function entry: every /api/* request is rewritten here (vercel.json) and handled by the Hono app.
import { handle } from 'hono/vercel';
import { createApp } from '../server/app.ts';

const handler = handle(createApp());

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
