function splitHeadersAndBody(rawEmail) {
	const separatorMatch = rawEmail.match(/\r?\n\r?\n/);
	if (!separatorMatch || separatorMatch.index === undefined) {
		return { headers: rawEmail, body: "" };
	}

	const separator = separatorMatch[0];
	const index = separatorMatch.index;
	return {
		headers: rawEmail.slice(0, index),
		body: rawEmail.slice(index + separator.length),
	};
}

function decodeQuotedPrintable(input) {
	if (!input) return "";
	return input
		.replace(/=\r?\n/g, "")
		.replace(/=([0-9A-F]{2})/gi, (_match, hex) =>
			String.fromCharCode(parseInt(hex, 16))
		);
}

function decodeBase64Text(input) {
	if (!input) return "";
	try {
		const normalized = input.replace(/\s+/g, "");
		if (!normalized) return "";
		const binary = atob(normalized);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
	} catch (_error) {
		return input;
	}
}

function stripHtmlTags(input) {
	if (!input) return "";
	return input
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&");
}

function normalizeText(input) {
	if (!input) return "";
	return input
		.replace(/\r/g, "")
		.replace(/[\t ]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function getHeaderValue(headers, headerName) {
	const escapedName = headerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = headers.match(new RegExp(`${escapedName}:\\s*([^\\r\\n]+(?:\\r?\\n[ \\t]+[^\\r\\n]+)*)`, "i"));
	if (!match) return "";
	return match[1].replace(/\r?\n[ \t]+/g, " ").trim();
}

function decodeMimePart(partHeaders, partBody) {
	const transferEncoding = getHeaderValue(partHeaders, "Content-Transfer-Encoding").toLowerCase();
	const contentType = getHeaderValue(partHeaders, "Content-Type").toLowerCase();
	let decoded = partBody.trim();

	if (transferEncoding.includes("base64")) {
		decoded = decodeBase64Text(decoded);
	} else if (transferEncoding.includes("quoted-printable")) {
		decoded = decodeQuotedPrintable(decoded);
	}

	if (contentType.includes("text/html")) {
		decoded = stripHtmlTags(decoded);
	}

	return normalizeText(decoded);
}

function extractBodyCandidates(rawEmail) {
	const { headers, body } = splitHeadersAndBody(rawEmail);
	const candidates = [];
	const boundaryHeader = getHeaderValue(headers, "Content-Type");
	const boundaryMatch = boundaryHeader.match(/boundary="?([^";]+)"?/i);

	if (boundaryMatch) {
		const boundary = `--${boundaryMatch[1]}`;
		const parts = body.split(boundary);

		for (const part of parts) {
			const trimmed = part.trim();
			if (!trimmed || trimmed === "--") continue;

			const { headers: partHeaders, body: partBody } = splitHeadersAndBody(trimmed);
			const partContentType = getHeaderValue(partHeaders, "Content-Type").toLowerCase();

			if (partContentType.startsWith("multipart/")) {
				const nested = extractBodyCandidates(`${partHeaders}\n\n${partBody}`);
				candidates.push(...nested);
				continue;
			}

			const decoded = decodeMimePart(partHeaders, partBody);
			if (decoded) candidates.push(decoded);
		}
	}

	const fallbackBody = normalizeText(stripHtmlTags(body));
	if (fallbackBody) candidates.push(fallbackBody);

	return [...new Set(candidates.filter(Boolean))];
}

function extractVerificationCode(rawEmail) {
	const candidates = extractBodyCandidates(rawEmail);
	const contextualPatterns = [
		/(?:verification|verify|security|login|one[- ]?time|passcode|otp|code)[^\d]{0,40}(\d{4,8})/i,
		/(\d{4,8})[^\d]{0,40}(?:verification|verify|security|login|one[- ]?time|passcode|otp|code)/i,
	];

	for (const candidate of candidates) {
		for (const pattern of contextualPatterns) {
			const match = candidate.match(pattern);
			if (match) return match[1];
		}
	}

	const fallbackMatches = [];
	for (const candidate of candidates) {
		const matches = candidate.match(/\b\d{6}\b/g) || [];
		fallbackMatches.push(...matches);
	}

	if (fallbackMatches.length === 1) return fallbackMatches[0];
	if (fallbackMatches.length > 1) return fallbackMatches[fallbackMatches.length - 1];

	return null;
}

export { extractVerificationCode };
