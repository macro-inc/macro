import GoogleIcon from '@icon/macro-google.svg';
import MicrosoftIcon from '@icon/microsoft-color.svg';
import HandIcon from '@icon/system/regular/hand-palm.svg';
import LockIcon from '@icon/system/regular/lock-key.svg';
import ShieldIcon from '@icon/system/regular/shield-check.svg';
import './email-providers.css';

/**
 * The app's sign-up screen for connecting a work inbox: continue with Google
 * or Microsoft, above its three privacy assurances. Keep the wording in step
 * with apps/web's onboarding `google-accounts-step`.
 */
export function EmailProvidersGraphic() {
  return (
    <div
      class="email-providers"
      role="img"
      aria-label="Macro’s sign-up screen: continue with Google or Microsoft to sync your inbox and calendar, with zero-retention agreements, audited security, and data that is never sold."
    >
      <div class="email-providers-screen" aria-hidden="true">
        <h3>
          Continue with your work <br />
          email and calendar.
        </h3>
        <p>
          Sync your inbox and calendar securely.
          <br /> You can disconnect anytime.
        </p>
        <div class="email-providers-buttons">
          <span class="email-providers-google">
            <GoogleIcon viewBox="0 0 24 24" fill="currentColor" stroke="none" />
            Continue with Google
          </span>
          <span class="email-providers-microsoft">
            <MicrosoftIcon />
            Continue with Microsoft
          </span>
        </div>
        <div class="email-providers-trust">
          <div>
            <LockIcon />
            <strong>Zero retention</strong>
            <span>
              Agreements with
              <br />
              OpenAI &amp; Anthropic
            </span>
          </div>
          <div>
            <ShieldIcon />
            <strong>Audited security</strong>
            <span>
              SOC 2 · ISO 27001
              <br />
              CASA Tier 2
            </span>
          </div>
          <div>
            <HandIcon />
            <strong>Never sold</strong>
            <span>
              No generalized
              <br />
              AI model training.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
