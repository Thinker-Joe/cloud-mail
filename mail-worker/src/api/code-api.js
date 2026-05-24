import app from '../hono/hono';
import orm from '../entity/orm';
import email from '../entity/email';
import { eq, desc, gte } from 'drizzle-orm';

const MAX_AGE_MINUTES = 10;

app.get('/code', async (c) => {
	const emailAddr = c.req.query('email');

	if (!emailAddr) {
		return c.text('Missing email param', { status: 400 });
	}

	try {
		const cutoff = new Date(Date.now() - MAX_AGE_MINUTES * 60 * 1000)
			.toISOString()
			.replace('T', ' ')
			.slice(0, 19);

		const emailRow = await orm(c).select().from(email)
			.where(
				eq(email.toEmail, emailAddr)
			)
			.orderBy(desc(email.emailId))
			.limit(1)
			.get();

		if (!emailRow || !emailRow.code) {
			return c.text('Not found', { status: 404 });
		}

		if (emailRow.createTime < cutoff) {
			return c.text('Expired', { status: 404 });
		}

		const shouldDelete = c.req.query('delete');
		if (shouldDelete === 'true') {
			await orm(c).update(email).set({ code: '' })
				.where(eq(email.emailId, emailRow.emailId))
				.run();
		}

		return c.text(emailRow.code);
	} catch (e) {
		console.error('code-api error:', e);
		return c.text('Error', { status: 500 });
	}
});
