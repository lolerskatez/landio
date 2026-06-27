/**
 * Script to extract inline <style> blocks from HTML files into external CSS files
 * and update the HTML to use <link> tags instead.
 * 
 * Usage: node scripts/extract-css.js
 */

const fs = require('fs');
const path = require('path');

const PAGES = [
    'dashboard.html',
    'index.html',
    'settings.html',
    'manage-services.html',
    'user-management.html',
    'logs.html',
    'login.html',
    'onboarding.html',
    'setup.html'
];

const STYLES_DIR = path.join(__dirname, '..', 'styles', 'pages');

// Ensure styles/pages directory exists
if (!fs.existsSync(STYLES_DIR)) {
    fs.mkdirSync(STYLES_DIR, { recursive: true });
}

PAGES.forEach(pageName => {
    const filePath = path.join(__dirname, '..', pageName);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return;
    }

    let html = fs.readFileSync(filePath, 'utf8');
    const originalHtml = html;

    // Extract ALL <style> blocks and concatenate them
    const styleRegex = /<style>([\s\S]*?)<\/style>/g;
    const matches = [...html.matchAll(styleRegex)];

    if (matches.length === 0) {
        console.log(`${pageName}: No <style> blocks found, skipping.`);
        return;
    }

    const cssContent = matches.map(m => m[1].trim()).join('\n\n');
    const cssFileName = pageName.replace('.html', '.css');
    const cssFilePath = path.join(STYLES_DIR, cssFileName);

    // Write the CSS file
    fs.appendFileSync(cssFilePath, cssContent, 'utf8');
    console.log(`Created/Updated: styles/pages/${cssFileName} (${cssContent.length} bytes, ${matches.length} block(s))`);

    // Replace ALL <style> blocks with a single <link> tag
    html = html.replace(
        /[ \t]*<style>[\s\S]*?<\/style>\s*/g,
        ''
    );
    // Add the link tag (only once) at the position of the last style block
    html = html.replace(
        '</head>',
        '    <link rel="stylesheet" href="/styles/pages/' + cssFileName + '">\n</head>'
    );

    // Add base.css and nav.css links in the head if not already present
    const baseCssLink = '<link rel="stylesheet" href="/styles/base.css">';
    const navCssLink = '<link rel="stylesheet" href="/styles/nav.css">';

    if (!html.includes('/styles/base.css')) {
        html = html.replace(
            '<link rel="stylesheet" href="/assets/fontawesome/all.min.css">',
            '<link rel="stylesheet" href="/assets/fontawesome/all.min.css">\n    ' + baseCssLink
        );
    }

    if (!html.includes('/styles/nav.css')) {
        html = html.replace(
            '</head>',
            '    ' + navCssLink + '\n</head>'
        );
    }

    if (html !== originalHtml) {
        fs.writeFileSync(filePath, html, 'utf8');
        console.log(`Updated: ${pageName}`);
    } else {
        console.log(`${pageName}: No changes needed.`);
    }
});

console.log('\nDone! All CSS extracted.');
