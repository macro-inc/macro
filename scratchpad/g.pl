undef $/; $_=<STDIN>;
s/import \{ Suspense \} from 'solid-js';/import { createSignal, Suspense } from 'solid-js';/ or die 1;
s/(  it\('gates a narrow query contract the same way')/  it('does not suspend when a query that failed without data takes new options', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    const [ids, setIds] = createSignal(['a']);
    let suspensions = 0;
    let query: UseQueryResult<string> | undefined;
    function Fallback() {
      suspensions += 1;
      return <div data-testid="suspended" \/>;
    }
    function View() {
      query = useQuery(() => ({
        queryKey: ['gate-test', ids()],
        queryFn: async (): Promise<string> => {
          throw new Error('Offline');
        },
      }));
      const result = query;
      return (
        <div data-testid="content">
          {queryReadyGate(result) ? result.data : 'pending'}
        <\/div>
      );
    }
    render(() => (
      <QueryClientProvider client={client}>
        <Suspense fallback={<Fallback \/>}>
          <View \/>
        <\/Suspense>
      <\/QueryClientProvider>
    ));
    await waitFor(() => expect(query?.isError).toBe(true));

    \/\/ The same key from a new array, as a list that grew a page passes it.
    setIds(['a']);
    await Promise.resolve();
    await Promise.resolve();

    expect(suspensions).toBe(0);
    expectContent('pending');
  });

$1/ or die 2;
print;
