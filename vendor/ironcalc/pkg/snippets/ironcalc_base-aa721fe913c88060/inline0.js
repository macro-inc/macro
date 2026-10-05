
        const _fmtCache = new Map();
        function getFormatter(tz) {
            let f = _fmtCache.get(tz);
            if (!f) {
                f = new Intl.DateTimeFormat('en-US', {
                    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
                });
                _fmtCache.set(tz, f);
            }
            return f;
        }
        export function ic_tz_validate(name) {
            try { getFormatter(name); return true; }
            catch(_) { return false; }
        }
        export function ic_tz_all() {
            try {
                const list = Intl.supportedValuesOf('timeZone');

                const zones = new Set(list);

                const extras = [ 'UTC', 'GMT' ];

                for (const tz of extras) {
                    zones.add(tz);
                }

                return Array.from(zones);
            } catch(e) {
                // no support
                console.log(e);
                return [ ];
            }
        }
        export function ic_tz_parts(ms, tz) {
            const p = {};
            for (const x of getFormatter(tz).formatToParts(new Date(ms))) p[x.type] = x.value | 0;
            return [p.year, p.month, p.day, p.hour, p.minute, p.second];
        }
    