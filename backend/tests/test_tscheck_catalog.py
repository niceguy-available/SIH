def test_catalog_returns_curated_lroc_metadata(client):
    response = client.get('/catalog')
    assert response.status_code == 200, response.text[:300]
    rows = response.json()
    assert len(rows) >= 1
    assert any(row['product_id'] == 'NAC_POLE_P900N0000' for row in rows)
    row = rows[0]
    assert row['source'] == 'LROC Downloads'
    assert row['download_url'].startswith('https://')


def test_catalog_sources_expose_lroc_and_quickmap(client):
    response = client.get('/catalog/sources')
    assert response.status_code == 200, response.text[:300]
    sources = {item['name']: item for item in response.json()}
    assert sources['LROC Downloads']['status'] == 'verified'
    assert sources['LROC QuickMap']['status'] == 'unverified'
