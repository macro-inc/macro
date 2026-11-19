import sys
order="629f5ee706 30098d0ab9 fcab08e99c 9072a647fb f3dc36148a dd647ef04b 03332038f8 10bfafa35d 5917910135 1f9a3902e8 f117ccabc9 043bec9c56 498ae3e331 1f2c924635 2378ee6e8f cb65705c4a 064f8d41f6 8233da865e f88bf71dbc c6eb5f5c27 426e014ab3 aa241300fb b222b2fd62 7cc565059a 464823c633".split()
lines=[l for l in open(sys.argv[1]) if l.startswith('pick ')]
by={}
for l in lines: by[l.split()[1][:10]]=l
assert len(by)==len(order),(len(by),len(order))
open(sys.argv[1],'w').write(''.join(by[o] for o in order))
