import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
const compressed=new Map();

// Only explicitly routed vendor bytes may be reused; every reuse revalidates
// against their content so an installed dependency update takes effect at once.
export function sendStaticAsset(request,response,{path,type,body,policy}) {
 const vendor=path.startsWith("/vendor/");
 const gzip=vendor&&body.length>1024&&String(request.headers["accept-encoding"]||"").split(",").some(part=>{const [name,...parameters]=part.trim().split(";");return name==="gzip"&&!parameters.some(value=>/^q=0(?:\.0*)?$/.test(value.trim()));});
 const identity=vendor?createHash("sha256").update(body).digest("hex"):null;
 if(gzip){let saved=compressed.get(path);if(saved?.identity!==identity){saved={identity,body:gzipSync(body)};compressed.set(path,saved);}body=saved.body;}
 const etag=vendor?'"'+createHash("sha256").update(body).digest("hex")+'"':null;
 const headers={"content-type":type,"cache-control":vendor?"public, no-cache":"no-store",
  "content-security-policy":policy,"x-content-type-options":"nosniff","referrer-policy":"no-referrer",
  ...(etag?{etag,vary:"Accept-Encoding"}: {}),...(gzip?{"content-encoding":"gzip"}:{})};
 const validators=String(request.headers["if-none-match"]||"").split(",").map(value=>value.trim().replace(/^W\//,""));
 if(etag&&(validators.includes(etag)||validators.includes("*"))){response.writeHead(304,headers);response.end();return;}
 response.writeHead(200,{...headers,"content-length":body.length});
 response.end(request.method==="HEAD"?undefined:body);
}
