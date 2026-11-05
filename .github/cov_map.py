#!/usr/bin/env python3
"""Per test binary: which workspace source files ran. Usage: cov_map.py <nextest-list.json> <pool dir> <work dir> <out.jsonl.gz> <repo root>"""
import concurrent.futures as cf,glob,gzip,json,os,shutil,subprocess,sys
lst,pool,work,out,root=sys.argv[1:6]
suites=json.load(open(lst))['rust-suites']
os.makedirs(work,exist_ok=True)
items=sorted(suites.items())
def sig(i_item):
    i,(bid,s)=i_item
    d=f'{work}/m{i}'; os.makedirs(d,exist_ok=True)
    env=dict(os.environ,LLVM_PROFILE_FILE=f'{d}/%1m.profraw')
    try:
        subprocess.run([s['binary-path'],'--list','--format','terse'],cwd=s.get('cwd') or root,env=env,capture_output=True,timeout=120)
    except Exception as e:
        return bid,None
    f=glob.glob(d+'/*.profraw')
    r=os.path.basename(f[0]).rsplit('_',1)[0] if f else None
    shutil.rmtree(d,ignore_errors=True)
    return bid,r
with cf.ThreadPoolExecutor(16) as ex: sigs=dict(ex.map(sig,enumerate(items)))
print('binaries',len(items),'signatures',sum(1 for v in sigs.values() if v),flush=True)
def one(i_item):
    i,(bid,s)=i_item
    n=sum(1 for t in s['testcases'].values() if not t.get('ignored') and (t.get('filter-match') or {}).get('status','matches')=='matches')
    row=dict(id=bid,package=s.get('package-name') or s.get('package'),kind=s.get('kind'),name=s.get('binary-name'),tests=n,total=len(s['testcases']),files={},err=None)
    g=sigs.get(bid)
    if not g: row['err']='no signature'; return row
    raws=glob.glob(f'{pool}/{g}_*.profraw')
    if not raws: row['err']='no profile'; return row
    pd=f'{work}/{i}.profdata'
    try:
        subprocess.check_call(['llvm-profdata','merge','-sparse','-o',pd,*raws],stderr=subprocess.DEVNULL)
        j=subprocess.run(['llvm-cov','export','--summary-only',f'--instr-profile={pd}',s['binary-path']],capture_output=True,text=True,timeout=1800)
        d=json.loads(j.stdout)
        for f in d['data'][0]['files']:
            name=f['filename']
            if name.startswith(root): name=os.path.relpath(name,root)
            if name.startswith(('/','..')): continue
            r=f['summary']['regions']
            if r['covered']>0: row['files'][name]=[r['covered'],r['count']]
    except Exception as e:
        row['err']=repr(e)[:200]
    finally:
        if os.path.exists(pd): os.remove(pd)
    return row
with gzip.open(out,'wt') as f, cf.ThreadPoolExecutor(24) as ex:
    for row in ex.map(one,enumerate(items)):
        f.write(json.dumps(row)+'\n'); f.flush()
        print(row['id'],row['tests'],len(row['files']),row['err'] or '',flush=True)
