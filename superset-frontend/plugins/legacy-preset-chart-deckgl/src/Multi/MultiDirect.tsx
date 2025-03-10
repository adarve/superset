/* eslint-disable react/jsx-handler-names */
/* eslint-disable react/no-access-state-in-setstate */
/* eslint-disable camelcase */
/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { isEqual } from 'lodash';
import {
  Datasource,
  HandlerFunction,
  JsonObject,
  JsonValue,
  QueryFormData,
  usePrevious,
} from '@superset-ui/core';
import { Layer } from '@deck.gl/core';

import {
  DeckGLContainerHandle,
  DeckGLContainerStyledWrapper,
} from '../DeckGLContainer';
import layerGenerators from '../layers';
import { Viewport } from '../utils/fitViewport';
import { TooltipProps } from '../components/Tooltip';

export type DeckMultiDirectProps = {
  formData: QueryFormData;
  payload: JsonObject;
  setControlValue: (control: string, value: JsonValue) => void;
  viewport: Viewport;
  onAddFilter: HandlerFunction;
  height: number;
  width: number;
  datasource: Datasource;
  onSelect: () => void;
};

/**
 * MultiDirect - A version of the Multi chart that uses data directly 
 * from the payload rather than making separate API requests.
 * 
 * This implementation assumes that all data needed for subcharts is
 * already in the main chart payload.
 */
const DeckMultiDirect = (props: DeckMultiDirectProps) => {
  const containerRef = useRef<DeckGLContainerHandle>();

  const [viewport, setViewport] = useState<Viewport>();
  const [subSlicesLayers, setSubSlicesLayers] = useState<Record<number, Layer>>({});

  // Create a tooltip handler for all layers
  const setTooltip = useCallback((tooltip: TooltipProps['tooltip']) => {
    const { current } = containerRef;
    if (current) {
      current.setTooltip(tooltip);
    }
  }, []);

  // Generate layers directly from the payload
  const generateLayers = useCallback(
    (formData: QueryFormData, payload: JsonObject, viewport?: Viewport) => {
      console.log('MultiDirect - Generating layers from direct payload:', payload);
      
      // Update viewport from props if provided
      setViewport(viewport);
      
      // Start with fresh layers
      setSubSlicesLayers({});
      
      // Process each subslice
      if (payload.data?.slices) {
        console.log(`MultiDirect - Processing ${payload.data.slices.length} subcharts`);
        
        // Track layers to create
        const newLayers: Record<number, Layer> = {};
        
        payload.data.slices.forEach(
          (subslice: { slice_id: number } & JsonObject) => {
            // If we don't have a viz_type, we can't create a layer
            if (!subslice.form_data?.viz_type) {
              console.error(`Missing viz_type for subchart ${subslice.slice_id}`);
              return;
            }
            
            console.log(`MultiDirect - Processing subchart ${subslice.slice_id} of type ${subslice.form_data.viz_type}`);
            
            // Combine filters from parent chart and subchart
            const filters = [
              ...(subslice.form_data.filters || []),
              ...(formData.filters || []),
              ...(formData.extra_filters || []),
            ];
            
            // Create a copy of subslice with combined filters
            const subsliceCopy = {
              ...subslice,
              form_data: {
                ...subslice.form_data,
                filters,
                // Include adhoc_filters if they exist
                ...(formData.adhoc_filters ? { adhoc_filters: formData.adhoc_filters } : {}),
                // Include time_range if it exists in parent
                ...(formData.time_range ? { time_range: formData.time_range } : {}),
              },
            };
            
            // Check if this subchart has data
            if (subslice.data) {
              console.log(`MultiDirect - Subchart ${subslice.slice_id} has direct data:`, subslice.data);
              
              try {
                // Create a payload object similar to what would be returned by API
                const subchartPayload = {
                  form_data: subsliceCopy.form_data,
                  data: subslice.data,
                  // Ensure mapbox API key is passed
                  mapboxApiKey: payload.data.mapboxApiKey,
                };
                
                // Get the layer generator for this viz type
                const layerGenerator = layerGenerators[subsliceCopy.form_data.viz_type];
                
                if (!layerGenerator) {
                  console.error(`Unknown viz_type: ${subsliceCopy.form_data.viz_type}`);
                  return;
                }
                
                // Generate the layer
                const layer = layerGenerator(
                  subsliceCopy.form_data,
                  subchartPayload,
                  props.onAddFilter,
                  setTooltip,
                  props.datasource,
                  [],
                  props.onSelect,
                );
                
                console.log(`MultiDirect - Generated layer for subchart ${subslice.slice_id}:`, layer);
                
                // Add to our layers
                if (layer) {
                  newLayers[subslice.slice_id] = layer;
                }
              } catch (error) {
                console.error(`Error generating layer for subchart ${subslice.slice_id}:`, error);
              }
            } else {
              console.warn(`Subchart ${subslice.slice_id} has no data`);
            }
          },
        );
        
        // Update all layers at once
        console.log(`MultiDirect - Setting ${Object.keys(newLayers).length} layers`);
        setSubSlicesLayers(newLayers);
      } else {
        console.error('No slices found in payload.data');
      }
    },
    [props.datasource, props.onAddFilter, props.onSelect, setTooltip],
  );

  // Track changes to deck_slices and other filters
  const prevDeckSlices = usePrevious(props.formData.deck_slices);
  const prevFilters = usePrevious(props.formData.filters);
  const prevExtraFilters = usePrevious(props.formData.extra_filters);
  const prevAdhocFilters = usePrevious(props.formData.adhoc_filters);
  const prevTimeRange = usePrevious(props.formData.time_range);
  const prevPayload = usePrevious(props.payload);

  // Regenerate layers when relevant props change
  useEffect(() => {
    const { formData, payload } = props;
    
    // Log the payload to see what we're working with
    console.log('MultiDirect - Complete Props:', {
      formData,
      payload,
    });
    
    // Check various conditions that should trigger a reload of layers
    const slicesChanged = !isEqual(prevDeckSlices, formData.deck_slices);
    const filtersChanged = !isEqual(prevFilters, formData.filters);
    const extraFiltersChanged = !isEqual(prevExtraFilters, formData.extra_filters);
    const adhocFiltersChanged = !isEqual(prevAdhocFilters, formData.adhoc_filters);
    const timeRangeChanged = !isEqual(prevTimeRange, formData.time_range);
    const payloadChanged = !isEqual(prevPayload, payload);
    
    const hasChanges = slicesChanged || filtersChanged || extraFiltersChanged || 
                       adhocFiltersChanged || timeRangeChanged || payloadChanged;
    
    if (hasChanges) {
      console.log('MultiDirect - Detected changes requiring regeneration:', {
        slicesChanged,
        filtersChanged,
        extraFiltersChanged,
        adhocFiltersChanged,
        timeRangeChanged,
        payloadChanged
      });
      generateLayers(formData, payload);
    }
  }, [
    generateLayers, 
    prevDeckSlices, 
    prevFilters, 
    prevExtraFilters, 
    prevAdhocFilters,
    prevTimeRange,
    prevPayload,
    props
  ]);

  const { payload, formData, setControlValue, height, width } = props;
  const layers = Object.values(subSlicesLayers);
  
  // Log the layers being rendered
  console.log('MultiDirect - Final layers being rendered:', layers);

  return (
    <DeckGLContainerStyledWrapper
      ref={containerRef}
      mapboxApiAccessToken={payload.data.mapboxApiKey}
      viewport={viewport || props.viewport}
      layers={layers}
      mapStyle={formData.mapbox_style}
      setControlValue={setControlValue}
      onViewportChange={setViewport}
      height={height}
      width={width}
    />
  );
};

export default memo(DeckMultiDirect);