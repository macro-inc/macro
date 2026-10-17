# Macro CRM LinkedIn Extension

A Chrome extension that adds a button to LinkedIn profiles to quickly add contacts to your Macro CRM.

## Features

- **One-click contact addition**: Add LinkedIn contacts to Macro CRM directly from their profile page
- **Automatic data extraction**: Extracts name, company, title, and location from LinkedIn profiles
- **Smart company matching**: Automatically finds or creates CRM companies based on the contact's current employer
- **Works with Sales Navigator**: Supports both regular LinkedIn profiles and Sales Navigator lead pages

## Installation

### Development

1. Install dependencies:
   ```bash
   cd packages/linkedin-crm-extension
   bun install
   ```

2. Build the extension:
   ```bash
   bun run build
   ```

3. Load in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

### Development mode

Run the build in watch mode for development:
```bash
bun run dev
```

## Configuration

1. Click the extension icon in Chrome
2. Click "Settings"
3. Enter your Macro API token (get one from [Macro Settings → API](https://macro.com/app/settings/api))
4. Click "Save Settings"

## Usage

1. Navigate to any LinkedIn profile page (`linkedin.com/in/...` or Sales Navigator lead page)
2. Click the "Add to Macro CRM" button that appears below the profile actions
3. The contact will be added to your Macro CRM with their company

## How it works

1. **Profile extraction**: The extension parses the LinkedIn profile page to extract:
   - Full name
   - Current job title
   - Current company
   - Location

2. **Company resolution**: 
   - The extension attempts to find an existing company in your CRM by the company's domain
   - If no company exists, it creates a new one

3. **Contact creation**:
   - Creates a new contact under the company
   - Generates an email address based on the person's name and company domain

## Supported pages

- Regular LinkedIn profiles: `https://www.linkedin.com/in/*`
- Sales Navigator leads: `https://www.linkedin.com/sales/lead/*`

## Privacy

This extension:
- Only runs on LinkedIn pages
- Only sends data to your configured Macro instance
- Stores your API token locally in Chrome's sync storage
- Does not track usage or send data to third parties
