import os
items=[]
os.chdir('target')
items.append(('.rustc_info.json',os.path.getsize('.rustc_info.json')))
def tree(p):
    n=0
    for r,_,fs in os.walk(p):
        for f in fs:
            try: n+=os.path.getsize(os.path.join(r,f))
            except OSError: pass
    return n
for d in ('debug/incremental','debug/build','debug/.fingerprint'):
    for e in os.listdir(d):
        items.append((f'{d}/{e}',tree(f'{d}/{e}')))
for e in os.listdir('debug/deps'):
    items.append((f'debug/deps/{e}',tree(f'debug/deps/{e}') if os.path.isdir(f'debug/deps/{e}') else os.path.getsize(f'debug/deps/{e}')))
items.sort(key=lambda x:-x[1])
bins=[[0,[]] for _ in range(8)]
for path,size in items:
    b=min(bins,key=lambda x:x[0]); b[0]+=size; b[1].append(path)
for i,(n,paths) in enumerate(bins):
    open(f'../shard{i}.list','w').write('\n'.join(paths)+'\n'); print('shard',i,round(n/1e9,1),'GB',len(paths))
