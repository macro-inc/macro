import json,re,subprocess,sys,os
# usage: subset2.py bad1,bad2 : shrink members until no member reaches a bad crate, using cargo's real graph.
bad=set(sys.argv[1].split(','))
subprocess.check_call(['git','checkout','--','Cargo.toml','Cargo.lock','crates/workspace-hack/Cargo.toml'])
h='crates/workspace-hack/Cargo.toml'; t=open(h).read(); a=t.index('### BEGIN HAKARI SECTION'); b=t.index('### END HAKARI SECTION'); open(h,'w').write(t[:a]+'### BEGIN HAKARI SECTION\n'+t[b:])
src=open('Cargo.toml').read()
def write(keep):
    s=re.sub(r'(?ms)^members = \[.*?^\]', 'members = [\n'+''.join(f'  "{k}",\n' for k in sorted(keep))+']', src, count=1)
    open('Cargo.toml','w').write(s)
keep=None
for _ in range(30):
    m=json.loads(subprocess.run('cargo metadata --offline --format-version 1 --all-features'.split(),capture_output=True,text=True,check=True).stdout)
    P={p['id']:p for p in m['packages']}; R={n['id']:n for n in m['resolve']['nodes']}; wm=set(m['workspace_members']); root=m['workspace_root']
    def reach(i):
        s=set();st=[i]
        while st:
            x=st.pop()
            if x in s: continue
            s.add(x);st.extend(R[x]['dependencies'])
        return {P[x]['name'] for x in s}
    good=[os.path.relpath(os.path.dirname(P[i]['manifest_path']),root) for i in wm if P[i]['name']!='sync_service' and not (reach(i)&bad)]
    if keep is not None and set(good)==set(keep): break
    keep=good; write(keep)
print(len(keep),'members')
