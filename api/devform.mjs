export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ status: 'ok' });

  const TOKEN = process.env.NOTION_TOKEN;
  if (!TOKEN) return res.status(500).json({ success: false, error: 'NOTION_TOKEN not set' });

  try {
    const { clientId, products, timestamp } = req.body;
    const DEV_DB_ID = '383987733a9f4dbca74ca3a960d02f69'; // 📋 기획개발의뢰서 DB (제조사? 페이지)

    const createdPages = [];

    for (const p of products) {
      const properties = {
        '제품명': { title: [{ text: { content: p.productName || '' } }] },
        '용량': { rich_text: [{ text: { content: p.volume || '' } }] },
        '생산수량': { rich_text: [{ text: { content: String(p.quantity || '') } }] },
        '목표가격': { rich_text: [{ text: { content: p.targetPrice || '' } }] },
        '제형·텍스처': { rich_text: [{ text: { content: p.formulation || '' } }] },
        '타겟효능': { rich_text: [{ text: { content: p.targetEffect || '' } }] },
        '주요성분요청': { rich_text: [{ text: { content: p.ingredients || '' } }] },
        '패키지·용기': { rich_text: [{ text: { content: p.packaging || '' } }] },
        '추가요청사항': { rich_text: [{ text: { content: p.additionalNotes || '' } }] },
        '상태': { status: { name: '시작 전' } },
      };

      if (p.productType) properties['제품유형'] = { select: { name: p.productType } };
      if (p.reference) properties['레퍼런스'] = { url: p.reference.startsWith('http') ? p.reference : null };

      // Relation to client page
      if (clientId) {
        properties['의뢰사'] = { relation: [{ id: clientId }] };
      }

      // Page body content
      const children = [];

      if (p.ingredients) {
        children.push(
          { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: '🧪 주요 성분 요청' } }] } },
          { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: p.ingredients } }] } },
        );
      }
      if (p.packaging) {
        children.push(
          { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: '📦 패키지 / 용기' } }] } },
          { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: p.packaging } }] } },
        );
      }
      if (p.reference) {
        children.push(
          { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: '🔗 레퍼런스' } }] } },
          { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: p.reference } }] } },
        );
      }
      if (p.additionalNotes) {
        children.push(
          { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: '📝 추가 요청사항' } }] } },
          { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: p.additionalNotes } }] } },
        );
      }

      const page = await notionCall(TOKEN, 'POST', '/pages', {
        parent: { database_id: DEV_DB_ID },
        properties,
        children: children.length > 0 ? children : undefined,
      });

      createdPages.push({ id: page.id, url: page.url, name: p.productName });
    }

    return res.status(200).json({
      success: true,
      pages: createdPages,
      count: createdPages.length,
    });
  } catch (err) {
    console.error('DevForm Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function notionCall(token, method, endpoint, body) {
  const r = await fetch('https://api.notion.com/v1' + endpoint, {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Notion ' + r.status + ': ' + (d.message || 'error'));
  return d;
}
