function i(s,t="Error inesperado"){let r=s,o=r?.error?.error,e=r?.message,n=r?.status?`HTTP ${r.status}`:"";return[o||e||t,n].filter(Boolean).join(" | ")||t}export{i as a};
