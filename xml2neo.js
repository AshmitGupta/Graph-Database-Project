const neo4j = require('neo4j-driver');
const fs = require('fs');
const path = require('path');

// Connect to the Neo4j instance
const uri = 'your_neo4j_url';  // Replace with your Neo4j URL
const user = 'your_username';  // Replace with your Neo4j username
const password = 'your_password';  // Replace with your Neo4j password
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
const session = driver.session({ database: "newDatabase" });

// List of XML files
const xmlFiles = [
    'boeing_service_bulletin_1.xml',
    'boeing_service_bulletin_2.xml',
    'boeing_service_bulletin_3.xml'
];

// Function to create a tagged node
async function createTaggedNode(session, label, properties, tag) {
    properties[tag] = true;
    const query = `
        CREATE (n:${label} $props)
        RETURN id(n) as nodeId
    `;
    const result = await session.run(query, { props: properties });
    return result.records[0].get('nodeId').toInt();
}

// Function to create relationships
async function createRelationship(session, fromNodeId, toNodeId, relationshipType) {
    const query = `
        MATCH (a), (b)
        WHERE id(a) = $fromNodeId AND id(b) = $toNodeId
        CREATE (a)-[r:${relationshipType}]->(b)
    `;
    await session.run(query, { fromNodeId, toNodeId });
}

// Function to match or create a tagged node
async function matchOrCreateTaggedNode(session, label, properties, tag) {
    const query = `
        MATCH (n:${label} $props)
        RETURN id(n) as nodeId
    `;
    const result = await session.run(query, { props: properties });
    if (result.records.length > 0) {
        return result.records[0].get('nodeId').toInt();
    } else {
        return await createTaggedNode(session, label, properties, tag);
    }
}

// Function to extract content between tags
function extractContent(line, tag) {
    const start = `<${tag}>`;
    const end = `</${tag}>`;
    return line.substring(line.indexOf(start) + start.length, line.indexOf(end)).trim();
}

// Function to extract nested content
function extractNestedContent(line, tag) {
    const start = `<${tag}>`;
    const end = `</${tag}>`;
    return line.substring(line.indexOf(start) + start.length, line.lastIndexOf(end)).trim();
}

// Function to extract airplane types and line numbers from content
function extractAirplanesAndLines(content) {
    let airplaneTypes = [];
    let lineNumbers = [];

    if (content.includes('Airplane(s), line number(s)')) {
        const parts = content.split('Airplane(s), line number(s)');
        airplaneTypes = parts[0].trim().split(/\s+/);  // Split airplane types by spaces
        lineNumbers = parts[1].trim().split(',').map(line => line.trim());  // Split line numbers by commas
    }

    return { airplaneTypes, lineNumbers };
}

// Function to create nodes and relationships recursively
async function createNodesAndRelationships(session, parentNodeId, element, tagName = null) {
    const lines = element.split('\n');
    for (const child of lines) {
        const line = child.trim();
        if (line.startsWith('<effectivity>')) {
            const effectivityNodeId = await createTaggedNode(session, 'effectivity', { name: 'effectivity' }, "added_for_bulletin");
            await createRelationship(session, parentNodeId, effectivityNodeId, 'effectivity');
            await createRelationship(session, effectivityNodeId, parentNodeId, "included_in");

        } else if (line.startsWith('<airplanes>')) {
            const airplanesContent = extractContent(line, 'airplanes');
            console.log(`Airplanes content: ${airplanesContent}`);

            const { airplaneTypes, lineNumbers } = extractAirplanesAndLines(airplanesContent);
            console.log(`Airplane types: ${airplaneTypes}`);
            console.log(`Line numbers: ${lineNumbers}`);

            for (const airplaneType of airplaneTypes) {
                const airplaneNodeId = await createTaggedNode(session, "Airplane", { name: airplaneType }, "added_for_bulletin");
                await createRelationship(session, effectivityNodeId, airplaneNodeId, "effects");
                await createRelationship(session, airplaneNodeId, effectivityNodeId, "affected_by");
                console.log(`Created Airplane node: ${airplaneType}`);

                for (const lineNumber of lineNumbers) {
                    const lineNumberNodeId = await matchOrCreateTaggedNode(session, "LineNumber", { name: lineNumber }, "added_for_bulletin");
                    await createRelationship(session, airplaneNodeId, lineNumberNodeId, "includes");
                    await createRelationship(session, lineNumberNodeId, airplaneNodeId, "included_in");
                    console.log(`Created or connected to LineNumber node: ${lineNumber}`);
                }
            }
        } else if (line.startsWith('<') && line.endsWith('>')) {
            tagName = line.substring(1, line.indexOf('>')).split(' ')[0];
            const content = extractContent(line, tagName);
            if (content) {
                const nodeId = await createTaggedNode(session, tagName, { name: tagName, content }, "added_for_bulletin");
                await createRelationship(session, parentNodeId, nodeId, tagName);
                await createRelationship(session, nodeId, parentNodeId, "included_in");
            } else {
                const nestedContent = extractNestedContent(line, tagName);
                const nodeId = await createTaggedNode(session, tagName, { name: tagName }, "added_for_bulletin");
                await createRelationship(session, parentNodeId, nodeId, tagName);
                await createRelationship(session, nodeId, parentNodeId, "included_in");
                await createNodesAndRelationships(session, nodeId, nestedContent, tagName);
            }
        }
    }
}

// Process each XML file
async function processFiles() {
    for (const xmlFile of xmlFiles) {
        const xmlPath = path.resolve(__dirname, xmlFile);
        const xmlContent = fs.readFileSync(xmlPath, 'utf8');

        // Create the main service bulletin node
        const bulletinNumber = extractContent(xmlContent, 'number');
        const bulletinNodeId = await createTaggedNode(session, "ServiceBulletin", { name: bulletinNumber }, "added_for_bulletin");

        // Create nodes and relationships from the XML
        await createNodesAndRelationships(session, bulletinNodeId, xmlContent);
    }
    console.log("Graph created successfully.");
}

// Run the processing
processFiles()
    .then(() => session.close())
    .catch(error => console.error('Error:', error))
    .finally(() => driver.close());
