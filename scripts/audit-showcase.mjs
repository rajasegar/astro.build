import { parseHTML } from 'linkedom';
import { downloadBrowser } from 'puppeteer/lib/esm/puppeteer/node/install.js';

await downloadBrowser();

class ShowcaseAuditor {
	/**
	 * Run the showcase scraper, extract & filter links from the GitHub discussion,
	 * test they are pointing to Astro sites, and add new ones to the repo.
	 * @returns {Promise<void>}
	 */
	async run() {
		const hrefs = await ShowcaseAuditor.#getLiveShowcaseUrls();

		/** @type {{ astro: string[]; nonAstro: string[]; failed: string[] }} */
		const sites = { astro: [], nonAstro: [], failed: [] };
		console.log(`Searching ${hrefs.size} URL(s) for sites built with Astro...`);
		for (const href of hrefs) {
			try {
				const isAstroSite = await ShowcaseAuditor.#isAstro(href);
				sites[isAstroSite ? 'astro' : 'nonAstro'].push(href);
			} catch {
				sites.failed.push(href);
			}
		}

		this.setActionOutput(sites);
	}

	/**
	 * Expose data from this run to GitHub Actions for use in other steps.
	 * We set a `prBody` output for use when creating a PR from this run’s changes.
	 * @param {{
	 * 	scraped: { url: string; title: string | undefined }[];
	 * 	failed: string[];
	 * 	nonAstro: string[]
	 * }} sites
	 */
	setActionOutput(sites) {
		const prLines = [
			"This PR is auto-generated by a GitHub action that runs every month to audit sites in Astro's showcase.",
			'',
		];

		if (sites.failed.length > 0) {
			prLines.push(
				'#### Sites that failed to load 🚨',
				'',
				'These sites are currently in the showcase, but something went wrong while trying to scrape them. You might want to remove them from the showcase if the sites are no longer live.',
				'',
				...sites.failed.map((url) => `- ${url}`),
				'',
			);
		}

		if (sites.nonAstro.length > 0) {
			prLines.push(
				'#### Sites that are maybe not built with Astro 🤔',
				'',
				'We couldn’t detect that these sites were built with Astro. You might want to check manually and remove any that are no longer built with Astro.',
				'',
				sites.nonAstro.map((url) => `- ${url}`),
				'',
			);
		}

		console.log(prLines.join('\n'));
	}

	/**
	 * @param {URL} url URL to test
	 * @returns {boolean}
	 */
	static #isAstroAssetURL({ pathname }) {
		return (
			// default Astro v2 assets directory
			pathname.startsWith('/_astro/') ||
			// any JS file that matches the `hoisted.{hash}.js` pattern
			/\/hoisted\.[a-z0-9]+\.js$/.test(pathname) ||
			// old Astro v1 style hashed files in `/assets/` directory
			/^\/assets\/.+\.[a-z0-9_]+\.(css|js|jpeg|jpg|webp|avif|png)$/.test(pathname)
		);
	}

	/**
	 * Try to decide if a given webpage is built with Astro
	 * @param {string | URL} url URL to test
	 * @returns Promise<boolean>
	 */
	static async #isAstro(url) {
		let raw = '';
		try {
			const res = await fetch(url);
			raw = await res.text();
		} catch (error) {
			console.error('Failed to fetch', url);
			throw error;
		}

		const { document } = parseHTML(raw);

		const generator = document.querySelector('meta[name="generator"]');
		if (generator?.getAttribute('content')?.startsWith('Astro')) {
			return true;
		}

		if (
			document.querySelector('astro-island') ||
			document.querySelector('[class*="astro-"]') ||
			document.querySelector('[astro-script]')
		) {
			return true;
		}

		const hrefEls = document.querySelectorAll('[href]');
		for (const el of hrefEls) {
			const href = el.getAttribute('href');
			if (href && ShowcaseAuditor.#isAstroAssetURL(new URL(href, import.meta.url))) {
				return true;
			}
		}

		const srcEls = document.querySelectorAll('[src]');
		for (const el of srcEls) {
			const src = el.getAttribute('src');
			if (src && ShowcaseAuditor.#isAstroAssetURL(new URL(src, import.meta.url))) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Fetch URLs from live `/api/showcase.json`.
	 * @returns {Promise<Set<string>>}
	 */
	static async #getLiveShowcaseUrls() {
		const showcaseJsonUrl = 'https://astro.build/api/showcase.json';
		/** @type {{ title: string; url: string }[]} */
		let data = [];
		try {
			const res = await fetch(showcaseJsonUrl);
			const json = await res.json();
			data = json;
		} catch {
			console.error('Failed to fetch', showcaseJsonUrl);
		}
		return new Set(data.map(({ url }) => new URL(url).origin));
	}
}

const auditor = new ShowcaseAuditor();
await auditor.run();
