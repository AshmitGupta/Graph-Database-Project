const neo4j = require('neo4j-driver');
const xml2js = require('xml2js');
const fs = require('fs');

async function createGraphFromXML(xmlData) {
    const driver = neo4j.driver('bolt://127.0.0.1:7687', neo4j.auth.basic('neo4j', 'password'), { encrypted: 'ENCRYPTION_OFF' });
    const session = driver.session();

    const uniqueLabel = 'Batch_2024_08_26';

    try {
        const parser = new xml2js.Parser({ explicitArray: false, trim: true });
        const result = await parser.parseStringPromise(xmlData);

        // Helper function to sanitize labels
        function sanitizeLabel(label) {
            return label.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
        }

        // Helper function to derive meaningful label from content
        function getNodeLabel(content) {
            return content.replace(/\s+/g, '_').substring(0, 20); // Truncate and sanitize
        }

        async function createNodesAndRelationships(obj, headers = []) {
            // Process THEAD (Headers)
            if (obj.THEAD) {
                const headerLabels = obj.THEAD.ROW.CELL.map(cell => cell.PARA); // Extract headers
                headers = headerLabels.map(header => sanitizeLabel(header.replace(/\s+/g, '_').substring(0, 20)));

                for (const header of headers) {
                    await session.writeTransaction(tx => tx.run(
                        `MERGE (h:\`${header}\`:\`${uniqueLabel}\` {name: $name})`,
                        { name: header }
                    ));
                }
            }

            // Process TBODY (Rows and Cells)
            if (obj.TBODY && obj.TBODY.ROW) {
                const rows = obj.TBODY.ROW;
                for (let i = 0; i < rows.length; i++) {
                    const rowNodeLabel = `Row_${i + 1}`; // Label for the row
                    await session.writeTransaction(tx => tx.run(
                        `MERGE (r:\`${rowNodeLabel}\`:\`${uniqueLabel}\`)`
                    ));

                    const cells = rows[i].CELL;
                    for (let j = 0; j < cells.length; j++) {
                        const cellContent = cells[j].PARA ? getNodeLabel(cells[j].PARA) : `Empty_Content`;
                        const header = headers[j] || `Header_${j}`; // Link to the corresponding header

                        // Create Cell Content
                        await session.writeTransaction(tx => tx.run(
                            `MERGE (content:\`${cellContent}\`:\`${uniqueLabel}\` {name: $name})`,
                            { name: cellContent }
                        ));

                        // Link Header to Cell Content
                        await session.writeTransaction(tx => tx.run(
                            `MATCH (header:\`${header}\`:\`${uniqueLabel}\`), (content:\`${cellContent}\`:\`${uniqueLabel}\`)
                            MERGE (header)-[:HEADER_OF]->(content)`
                        ));

                        // Link Row to Cell Content
                        await session.writeTransaction(tx => tx.run(
                            `MATCH (row:\`${rowNodeLabel}\`:\`${uniqueLabel}\`), (content:\`${cellContent}\`:\`${uniqueLabel}\`)
                            MERGE (row)-[:CONTAINS]->(content)`
                        ));
                    }
                }
            }
        }

        const rootLabel = Object.keys(result)[0];
        await createNodesAndRelationships(result[rootLabel]);

        console.log('Graph created successfully with unique label:', uniqueLabel);
    } catch (error) {
        console.error('Error creating graph:', error);
    } finally {
        await session.close();
        await driver.close();
    }
}

fs.readFile('your_xml_data.xml', 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading XML file:', err);
        return;
    }

    createGraphFromXML(data);
});
