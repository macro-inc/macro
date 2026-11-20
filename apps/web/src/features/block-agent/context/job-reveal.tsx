import {
  createContext,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';

/** Brings a background job's card into view, from outside the transcript. */
type RevealJob = (jobId: string) => void;

type JobReveal = {
  /** The transcript registers how it scrolls to a job; returns an unregister. */
  register: (reveal: RevealJob) => () => void;
  reveal: RevealJob;
};

const JobRevealContext = createContext<JobReveal>();

/**
 * Scopes job reveal to one session view: the transcript, a virtual list,
 * knows how to bring an unmounted card's message into view, and the composer's
 * running chip asks it to.
 */
export function JobRevealProvider(props: ParentProps) {
  const [current, setCurrent] = createSignal<RevealJob>();
  const value: JobReveal = {
    register: (reveal) => {
      setCurrent(() => reveal);
      return () => {
        if (current() === reveal) setCurrent(undefined);
      };
    },
    reveal: (jobId) => current()?.(jobId),
  };
  return (
    <JobRevealContext.Provider value={value}>
      {props.children}
    </JobRevealContext.Provider>
  );
}

/** Absent outside a session view, where no transcript can reveal a job. */
export function useJobReveal() {
  return useContext(JobRevealContext);
}
