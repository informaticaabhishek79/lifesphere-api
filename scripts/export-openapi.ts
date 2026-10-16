/* Writes the OpenAPI document to openapi.json (used to generate the typed frontend client). */
import { writeFileSync } from 'node:fs';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { createApp } from '../src/bootstrap';

async function main() {
  process.env.PROCESS_ROLE = 'api';
  const app = await createApp({ logger: false });
  await app.init();
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('LifeSphere API').setVersion('1.0.0').addBearerAuth().build());
  writeFileSync('openapi.json', JSON.stringify(doc, null, 2));
  const ops = Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).length, 0);
  console.log(`openapi.json written: ${Object.keys(doc.paths).length} paths, ${ops} operations`);
  await app.close();
  process.exit(0);
}
main();
