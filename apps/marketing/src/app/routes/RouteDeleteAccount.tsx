import type { Component } from 'solid-js';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { UtilPlainText } from '../components/utils/UtilPlainText';
import { setPageSeo } from '../utils/utilSeo';
import './RouteLegal.css';

const content = `Macro

# Delete your Macro account

You can request deletion of your Macro account and associated personal data by email, including if you no longer have the app installed. Macro is operated by Coparse, Inc. dba Macro.

## Request deletion by email

1. Email [support@macro.com](mailto:support@macro.com?subject=Delete%20my%20Macro%20account) from the email address associated with your Macro account.
2. Use the subject “Delete my Macro account” and say that you want your account and associated personal data deleted.
3. We may ask you to verify your identity before fulfilling the request. Do not send your password or sign-in codes.

If you cannot access your account email, contact the same address and explain the situation so we can help verify your identity. You do not need to reinstall the app to make a request.

## Delete your account in the app

1. Open Macro and sign in.
2. Open Settings, then Account.
3. Below Log out, select Delete account and follow the confirmation steps. The final step asks you to press and hold the delete button for 5 seconds.

Account deletion is permanent. Save anything you need before confirming. Uninstalling the app does not delete your account.

## How long deletion takes

We aim to complete account deletion and associated cleanup within seven days after verifying your request. Some cleanup runs in the background. The retained data described below may remain longer.

## Data covered by deletion

The request covers your Macro account, profile information such as your name and email address, and associated personal data stored by Macro. Account cleanup includes owned documents, AI chats, projects, agent sessions, scheduled actions, and onboarding information.

Deleting your Macro account does not delete accounts you hold with connected providers, such as Google. Copies of content held independently by other people or services are outside Macro's account-deletion process. If you use Macro through an organization, that organization may be responsible for handling requests for data it controls.

## Data retention and exceptions

Messages and comments you shared in conversations or items owned by others may remain visible to participants after your account is deleted, preserving their conversation history. Account deletion does not automatically remove this shared content; it may remain until the message, comment, or containing conversation or item is deleted. If your request concerns personal information in shared content, identify that content when you contact [support@macro.com](mailto:support@macro.com).

As described in our [Privacy Policy](/privacy), some personal information may be retained where needed to comply with legal requirements, resolve disputes, establish legal defenses, conduct audits, or enforce our agreements. Retention periods depend on the type of information and the reason it must be kept. When there is no ongoing legitimate business need or legal reason to retain it, we delete or anonymize it.

Personal information in backup archives that cannot immediately be deleted is securely stored and isolated from further processing until deletion is possible. Contact [support@macro.com](mailto:support@macro.com) for information about retention that applies to your account or for help with a deletion request.
`;

export const RouteDeleteAccount: Component = () => {
  setPageSeo({
    title: 'Delete your account · Macro',
    description:
      'Request deletion of your Macro account and associated personal data by email or in the app. Learn what deletion covers and how retained data is handled.',
    path: '/delete-account',
  });

  return (
    <>
      <UtilPlainText content={content} lists />
      <div class="legal-doc-footer">
        <SectionMoreFeatures currentPath="/delete-account" footerOnly />
      </div>
    </>
  );
};
