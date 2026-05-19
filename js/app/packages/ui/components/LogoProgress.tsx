interface LogoProgressProps {
  level: number;
  total: number;
  class?: string;
}

const LOGO_PATH = 'm15.578 0.044-2.244 0.879v6.676c0 0.257 0.107 0.503 0.293 0.68l1.041 0.982 7.086 6.697 2.24-0.879v-6.676c0-0.257-0.105-0.501-0.293-0.678zM6.25 0.042 4.008 0.923v6.676c0 0.257 0.107 0.503 0.293 0.68l1.039 0.982 7.084 6.697 2.244-0.879v-6.676c0-0.257-0.103-0.501-0.291-0.678l-1.043-0.984zM2.252 5.083 0.01 5.962v6.676c0 0.257 0.107 0.503 0.293 0.68l2.793 2.64 2.244-0.879v-6.676c0-0.257-0.103-0.501-0.291-0.678z';

export function LogoProgress(props: LogoProgressProps) {
  const clipRight = () => `${100 - (props.level / props.total) * 100}%`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 16"
      class={props.class}
      display="block"
    >
      <path d={LOGO_PATH} fill="var(--b4)" />
      <path
        d={LOGO_PATH}
        fill="var(--a0)"
        style={{
          'clip-path': `inset(0 ${clipRight()} 0 0)`,
          transition: 'clip-path 0.3s ease',
        }}
      />
    </svg>
  );
}
