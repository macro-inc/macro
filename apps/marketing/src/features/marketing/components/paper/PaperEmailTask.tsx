import ArrowDown from '@icon/system/regular/arrow-down.svg';
import CheckSquare from '@icon/system/regular/check-square.svg';
import Envelope from '@icon/system/regular/envelope.svg';
import Link from '@icon/system/regular/link.svg';
import './paper-email-task.css';

/** Focus on the task and its source, without the full creation form. */
export function PaperEmailTask() {
  return (
    <div class="paper-email-task-flow">
      <div class="paper-email-task-source">
        <Envelope />
        <div>
          <span class="paper-email-task-caption">Email from Sam Okafor</span>
          <strong>Contract redlines</strong>
        </div>
      </div>
      <div class="paper-email-task-connector">
        <span>Create task</span>
        <ArrowDown />
      </div>
      <div class="paper-email-task-card">
        <div class="paper-email-task-title">
          <CheckSquare />
          <strong>Review the contract redlines</strong>
        </div>
        <div class="paper-email-task-details">
          <span>Not started</span>
          <span>Alex Rivera</span>
        </div>
        <div class="paper-email-task-link">
          <Link />
          <span>Contract redlines</span>
          <span class="paper-email-task-caption">Source email</span>
        </div>
      </div>
    </div>
  );
}
